package main

import (
	"embed"
	"fmt"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var frontendAssets embed.FS

func main() {
	application := NewDesktopApp()
	err := wails.Run(&options.App{
		Title:             "Study OS",
		Width:             1280,
		Height:            820,
		MinWidth:          960,
		MinHeight:         640,
		HideWindowOnClose: false,
		AssetServer:       &assetserver.Options{Assets: frontendAssets},
		BackgroundColour:  options.NewRGB(248, 250, 248),
		OnStartup:         application.Startup,
		OnShutdown:        application.Shutdown,
		Bind:              []interface{}{application},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "com.study-os.desktop.v01",
			OnSecondInstanceLaunch: func(_ options.SecondInstanceData) {
				// Wails keeps the first instance alive; v0.1 intentionally has no tray mode.
			},
		},
	})
	if err != nil {
		log.Fatal(fmt.Errorf("run Study OS desktop: %w", err))
	}
}
