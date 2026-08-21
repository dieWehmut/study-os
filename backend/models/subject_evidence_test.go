package models_test

import (
	"encoding/json"
	"testing"

	"study-os/backend/models"
)

func TestNormalizeSubjectAttemptEvidenceAcceptsEachSubjectTool(t *testing.T) {
	tests := []struct {
		name    string
		subject string
		tool    string
		data    string
	}{
		{name: "chinese", subject: "chinese", tool: "scoring_points", data: `{"points":["借景抒情"],"answer":"借景抒情表达思乡"}`},
		{name: "math", subject: "math", tool: "derivation", data: `{"lines":["2x+4=10","2x=6","x=3"]}`},
		{name: "english", subject: "english", tool: "long_sentence", data: `{"sentence":"The book that I bought is useful."}`},
		{name: "physics free body", subject: "physics", tool: "free_body", data: `{"forces":[{"id":"gravity-0","name":"重力","magnitude":10,"angle":270,"kind":"field"}]}`},
		{name: "physics motion", subject: "physics", tool: "motion", data: `{"stages":[{"id":"accelerate-0","name":"加速","v0":0,"v":10,"a":2,"t":5,"x":25,"derived":["v","x"]}]}`},
		{name: "chemistry", subject: "chemistry", tool: "equation", data: `{"equation":"2H2 + O2 = 2H2O"}`},
		{name: "geography", subject: "geography", tool: "causal_chain", data: `{"links":[{"cause":"城市化","effect":"下垫面硬化"}]}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			raw := json.RawMessage(`{"version":1,"subject":"` + test.subject + `","tool":"` + test.tool + `","data":` + test.data + `}`)
			normalized, err := models.NormalizeSubjectAttemptEvidence(test.subject, raw)
			if err != nil {
				t.Fatalf("normalize evidence: %v", err)
			}
			var envelope struct {
				Version int    `json:"version"`
				Subject string `json:"subject"`
				Tool    string `json:"tool"`
			}
			if err := json.Unmarshal(normalized, &envelope); err != nil {
				t.Fatalf("decode normalized evidence: %v", err)
			}
			if envelope.Version != 1 || envelope.Subject != test.subject || envelope.Tool != test.tool {
				t.Fatalf("normalized evidence = %s", normalized)
			}
		})
	}
}

func TestNormalizeSubjectAttemptEvidenceRejectsWrongSubjectAndMalformedData(t *testing.T) {
	tests := []struct {
		name    string
		subject string
		raw     string
	}{
		{name: "wrong subject", subject: "math", raw: `{"version":1,"subject":"physics","tool":"free_body","data":{"forces":[]}}`},
		{name: "wrong tool", subject: "chinese", raw: `{"version":1,"subject":"chinese","tool":"equation","data":{"equation":"H2"}}`},
		{name: "wrong version", subject: "math", raw: `{"version":2,"subject":"math","tool":"derivation","data":{"lines":["x=1","x=1"]}}`},
		{name: "too few derivation lines", subject: "math", raw: `{"version":1,"subject":"math","tool":"derivation","data":{"lines":["x=1"]}}`},
		{name: "empty equation", subject: "chemistry", raw: `{"version":1,"subject":"chemistry","tool":"equation","data":{"equation":" "}}`},
		{name: "motion type poisoning", subject: "physics", raw: `{"version":1,"subject":"physics","tool":"motion","data":{"stages":[{"id":"s","name":"加速","v0":"oops"}]}}`},
		{name: "motion unknown derived quantity", subject: "physics", raw: `{"version":1,"subject":"physics","tool":"motion","data":{"stages":[{"id":"s","name":"加速","derived":["energy"]}]}}`},
		{name: "motion negative time", subject: "physics", raw: `{"version":1,"subject":"physics","tool":"motion","data":{"stages":[{"id":"s","name":"加速","t":-1}]}}`},
		{name: "force magnitude out of range", subject: "physics", raw: `{"version":1,"subject":"physics","tool":"free_body","data":{"forces":[{"id":"g","name":"重力","magnitude":-1,"angle":270,"kind":"field"}]}}`},
		{name: "malformed", subject: "geography", raw: `{"version":1`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := models.NormalizeSubjectAttemptEvidence(test.subject, json.RawMessage(test.raw)); err == nil {
				t.Fatal("expected invalid evidence to be rejected")
			}
		})
	}
}

func TestNormalizeSubjectAttemptEvidenceKeepsEmptyEvidenceBackwardCompatible(t *testing.T) {
	for _, raw := range []json.RawMessage{nil, json.RawMessage(`{}`), json.RawMessage(`null`)} {
		normalized, err := models.NormalizeSubjectAttemptEvidence("math", raw)
		if err != nil {
			t.Fatalf("normalize empty evidence: %v", err)
		}
		if string(normalized) != "{}" {
			t.Fatalf("normalized = %s, want {}", normalized)
		}
	}
}
