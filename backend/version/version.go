// Package version exposes the build version, overridable at link time:
// go build -ldflags "-X study-os/backend/version.Version=v0.2.0"
package version

var Version = "0.2.0-dev"
