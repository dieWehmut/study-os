package audio

import (
	"context"
	"strings"
	"testing"
)

func TestSAPICommandPassesUserValuesThroughEnvironment(t *testing.T) {
	request := Request{
		Term:  `hello; Remove-Item C:\important`,
		Voice: `voice "quoted"`,
	}
	destination := `C:\Study OS\audio 'quoted'.wav`
	command := newSAPICommand(context.Background(), "powershell.exe", request, destination)

	arguments := strings.Join(command.Args, " ")
	for _, value := range []string{request.Term, request.Voice, destination} {
		if strings.Contains(arguments, value) {
			t.Fatalf("user value %q leaked into PowerShell arguments: %s", value, arguments)
		}
	}
	if !strings.Contains(arguments, "-EncodedCommand") {
		t.Fatalf("PowerShell command is not encoded: %s", arguments)
	}

	environment := strings.Join(command.Env, "\n")
	for _, expected := range []string{
		"STUDY_OS_SAPI_OUTPUT=" + destination,
		"STUDY_OS_SAPI_TERM=" + request.Term,
		"STUDY_OS_SAPI_VOICE=" + request.Voice,
	} {
		if !strings.Contains(environment, expected) {
			t.Fatalf("missing environment value %q", expected)
		}
	}
}
