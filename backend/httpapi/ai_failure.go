package httpapi

import (
	"study-os/backend/agent"
)

/**
 * What to tell the reader when an AI call fails.
 *
 * A missing key, model, or base URL is classified by the provider itself
 * (`ErrorConfigMissing`), and that is the reader's own next step — the app knows
 * exactly which setting is empty. Everything else stays the plain action, since
 * the reason there is the model's own behaviour and not something to do.
 */
func aiFailureMessage(action string, err error) string {
	if agent.ErrorClassOf(err) == agent.ErrorConfigMissing {
		return action + "：到「设置 → AI 服务商」里填写 API Key 与模型后再试"
	}
	return action
}
