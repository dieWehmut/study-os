package audio

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// SAPIProvider is an optional Windows-only pronunciation generator. It uses
// the inbox System.Speech assembly through PowerShell, so the core audio
// package remains buildable and dependency-free on other platforms.
type SAPIProvider struct {
	// executable is injectable for tests or installations with a custom
	// PowerShell location. An empty value selects powershell.exe.
	executable string
}

func NewSAPIProvider() *SAPIProvider {
	return &SAPIProvider{}
}

func (provider *SAPIProvider) Generate(ctx context.Context, request Request, destination string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		return fmt.Errorf("%w: Windows SAPI is available only on Windows", ErrGeneratorUnavailable)
	}
	if strings.TrimSpace(request.Term) == "" {
		return fmt.Errorf("%w: term is empty", ErrNotFound)
	}
	format, err := normalizedFormat(request.Format)
	if err != nil {
		return err
	}
	if format != "wav" {
		return fmt.Errorf("%w: SAPI output is WAV", ErrUnsupportedFormat)
	}
	if strings.TrimSpace(destination) == "" || filepath.Ext(destination) == "" {
		return fmt.Errorf("%w: destination is empty", ErrUnsafePath)
	}

	executable := provider.executable
	if executable == "" {
		executable = "powershell.exe"
	}
	// Values travel through the child process environment, never through script
	// interpolation, which prevents a term or destination becoming PowerShell code.
	script := `$output = [Environment]::GetEnvironmentVariable('STUDY_OS_SAPI_OUTPUT')
$term = [Environment]::GetEnvironmentVariable('STUDY_OS_SAPI_TERM')
$voice = [Environment]::GetEnvironmentVariable('STUDY_OS_SAPI_VOICE')
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($voice -and $voice.Trim().Length -gt 0) { $synth.SelectVoice($voice) }
  $synth.SetOutputToWaveFile($output)
  $synth.Speak($term)
} finally {
  $synth.Dispose()
}`
	encoded := base64.StdEncoding.EncodeToString([]byte(utf16LE(script)))
	command := exec.CommandContext(ctx, executable, "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded)
	command.Env = append(os.Environ(),
		"STUDY_OS_SAPI_OUTPUT="+destination,
		"STUDY_OS_SAPI_TERM="+request.Term,
		"STUDY_OS_SAPI_VOICE="+request.Voice,
	)
	if output, err := command.CombinedOutput(); err != nil {
		if errors.Is(ctx.Err(), context.Canceled) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return ctx.Err()
		}
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("%w: %s", ErrGeneratorUnavailable, message)
	}
	return nil
}

func utf16LE(value string) []byte {
	encoded := make([]byte, 0, len(value)*2)
	for _, character := range value {
		encoded = append(encoded, byte(character), byte(character>>8))
	}
	return encoded
}
