package httpapi_test

import (
	"net/http"
	"strings"
	"testing"

	"study-os/backend/config"
	"study-os/backend/httpapi"
)

// A remote vendor with no key is the reader's own next step, and the provider
// says so (`ErrorConfigMissing`) -- the handler used to flatten that into
// "整合生成失败", which tells someone with an unconfigured key nothing at all.
func TestAIFailuresNameTheMissingConfiguration(t *testing.T) {
	application := testApplication(t, config.Config{ActiveProvider: "deepseek"})
	router := httpapi.NewRouter(application)

	generate := requestJSON(t, router, http.MethodPost, "/api/integrate", map[string]any{
		"subject": "physics",
		"text":    "合力等于质量乘以加速度。",
	})
	if generate.Code != http.StatusServiceUnavailable {
		t.Fatalf("integrate = %d, body = %s", generate.Code, generate.Body.String())
	}
	if !strings.Contains(generate.Body.String(), "到「设置 → AI 服务商」") {
		t.Fatalf("integrate body = %s, want the missing configuration named", generate.Body.String())
	}

	compare := requestJSON(t, router, http.MethodPost, "/api/compare", map[string]any{
		"term_a": "速度", "term_b": "加速度",
	})
	if compare.Code != http.StatusServiceUnavailable || !strings.Contains(compare.Body.String(), "到「设置 → AI 服务商」") {
		t.Fatalf("compare = %d, body = %s", compare.Code, compare.Body.String())
	}

	// With the offline provider the same call works, so the message above is
	// about the configuration and not about the endpoint.
	offline := testApplication(t, config.Config{ActiveProvider: "mock"})
	ok := requestJSON(t, httpapi.NewRouter(offline), http.MethodPost, "/api/integrate", map[string]any{
		"subject": "physics",
		"text":    "合力等于质量乘以加速度。",
	})
	if ok.Code != http.StatusCreated {
		t.Fatalf("offline integrate = %d, body = %s", ok.Code, ok.Body.String())
	}
}
