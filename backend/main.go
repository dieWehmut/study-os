package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"study-os/backend/app"
	"study-os/backend/config"
	"study-os/backend/httpapi"
	"study-os/backend/launcher"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load configuration: %v", err)
	}

	var listener net.Listener
	if cfg.Launcher {
		if live, address := launcher.LiveInstance(cfg.DataDir); live {
			fmt.Println("学习系统已在运行：http://" + address)
			return
		}
		listener, err = launcher.Listen(cfg.ListenAddress, launcher.DefaultPortSpan)
		if err != nil {
			log.Fatalf("listen %s: %v", cfg.ListenAddress, err)
		}
		cfg.ListenAddress = listener.Addr().String()
		if err := launcher.WriteAddress(cfg.DataDir, cfg.ListenAddress); err != nil {
			log.Fatalf("record launcher address: %v", err)
		}
		defer launcher.RemoveAddress(cfg.DataDir)
	}

	serverCtx, cancelServer := context.WithCancel(ctx)
	defer cancelServer()

	application, err := app.New(serverCtx, app.Options{Config: cfg})
	if err != nil {
		log.Fatalf("start application: %v", err)
	}
	defer func() {
		if err := application.Close(); err != nil {
			log.Printf("close application: %v", err)
		}
	}()

	if application.Launcher != nil {
		application.Launcher.OnShutdown = func() {
			cancelServer()
		}
		application.Launcher.OnRestart = func() {
			restartScript := filepath.Join(cfg.DataDir, "restart.cmd")
			_ = exec.Command("cmd", "/c", "start", "", "/b", restartScript).Start()
			cancelServer()
		}
		go application.Launcher.RunWatchdog(serverCtx, 10*time.Minute)
	}

	server := &http.Server{
		Addr:              cfg.ListenAddress,
		Handler:           httpapi.NewRouter(application),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("学习系统后端已启动：http://%s", cfg.ListenAddress)
		if listener != nil {
			serverErrors <- server.Serve(listener)
		} else {
			serverErrors <- server.ListenAndServe()
		}
	}()

	select {
	case <-ctx.Done():
	case <-serverCtx.Done():
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve HTTP: %v", err)
		}
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		log.Printf("shutdown HTTP server: %v", err)
	}
}
