package httpapi

import "testing"

// RevealRecorderForTest watches what handleSystemReveal would have opened, so a
// test never starts a real file manager.
type RevealRecorderForTest struct {
	Opened []string
	Fail   bool
}

// StubRevealForTest replaces the file-manager launch for one test.
func StubRevealForTest(t *testing.T) *RevealRecorderForTest {
	t.Helper()
	recorder := &RevealRecorderForTest{}
	previous := startReveal
	startReveal = func(directory string) error {
		recorder.Opened = append(recorder.Opened, directory)
		if recorder.Fail {
			return errRevealRefused
		}
		return nil
	}
	t.Cleanup(func() { startReveal = previous })
	return recorder
}

// RevealCommandForTest exposes the platform table, which needs no desktop.
func RevealCommandForTest(goos, directory string) (string, []string) {
	return revealCommand(goos, directory)
}