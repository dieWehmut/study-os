package importer

import "fmt"

// RequestError is a rejection the reader can act on: the file they chose, the
// table they picked, the mapping they gave, or the state of the job they are
// working on.
//
// The message is the sentence shown to them, and the kind decides the status --
// 409 for the job's state, 400 for everything else. Both used to be decided by
// matching English words inside the message, which made the wording load-bearing:
// rewording one silently turned its 400 into a generic 500. Anything that is not
// a RequestError is our own failure and gets the generic answer.
type RequestError struct {
	Message string
	// Conflict marks the ones about the job's state rather than its content.
	Conflict bool
}

func (e *RequestError) Error() string {
	return e.Message
}

func inputError(message string) error {
	return &RequestError{Message: message}
}

func inputErrorf(format string, args ...any) error {
	return &RequestError{Message: fmt.Sprintf(format, args...)}
}

func conflictError(message string) error {
	return &RequestError{Message: message, Conflict: true}
}
