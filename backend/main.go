package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"study-os/backend/app"
	"study-os/backend/config"
	"study-os/backend/httpapi"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load configuration: %v", err)
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

	server := &http.Server{
		Addr:              cfg.ListenAddress,
		Handler:           httpapi.NewRouter(application),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("学习系统后端已启动：http://%s", cfg.ListenAddress)
		serverErrors <- server.ListenAndServe()
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
