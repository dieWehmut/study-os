package launcher

import (
	"context"
	"testing"
	"time"
)

// fastWatchdog shrinks the idle check so a test does not wait a real minute for
// the first tick.
func fastWatchdog(t *testing.T) {
	t.Helper()
	previous := watchdogInterval
	watchdogInterval = 5 * time.Millisecond
	t.Cleanup(func() { watchdogInterval = previous })
}

func watchdogService(t *testing.T) (*Service, <-chan struct{}) {
	t.Helper()
	shutdown := make(chan struct{}, 1)
	service := NewService(Options{})
	// Close runs OnShutdown in its own goroutine, so the channel is buffered.
	service.OnShutdown = func() { shutdown <- struct{}{} }
	return service, shutdown
}

func TestWatchdogKeepsAFreshlyStartedServerAlive(t *testing.T) {
	// The activity clock has to start at boot rather than at the zero value.
	// An unset atomic.Int64 reads back as time.Unix(0, 0) -- January 1970 --
	// which time.Since reports as decades of idleness, so the very first tick
	// would shut the server down before the browser ever connected. The gap
	// between double-clicking the icon and the first request is real: a
	// SmartScreen or firewall prompt can easily hold the launch past a minute.
	fastWatchdog(t)
	service, shutdown := watchdogService(t)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go service.RunWatchdog(ctx, time.Hour)

	select {
	case <-shutdown:
		t.Fatal("watchdog shut down a server that had not served a request yet")
	case <-time.After(60 * time.Millisecond):
	}
}

func TestWatchdogStillShutsDownAfterTheTabCloses(t *testing.T) {
	// The guard above must not be bought by disabling the watchdog: a closed
	// tab still has to leave no background process behind.
	fastWatchdog(t)
	service, shutdown := watchdogService(t)
	service.Touch()

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go service.RunWatchdog(ctx, time.Nanosecond)

	select {
	case <-shutdown:
	case <-time.After(2 * time.Second):
		t.Fatal("watchdog never shut down an idle server")
	}
}
