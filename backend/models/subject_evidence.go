package models

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const SubjectAttemptEvidenceVersion = 1

type subjectAttemptEvidenceEnvelope struct {
	Version int             `json:"version"`
	Subject string          `json:"subject"`
	Tool    string          `json:"tool"`
	Data    json.RawMessage `json:"data"`
}

var subjectEvidenceTools = map[string]map[string]struct{}{
	"chinese":   {"scoring_points": {}},
	"math":      {"derivation": {}},
	"english":   {"long_sentence": {}},
	"physics":   {"free_body": {}, "motion": {}},
	"chemistry": {"equation": {}},
	"geography": {"causal_chain": {}},
}

// NormalizeSubjectAttemptEvidence validates the versioned subject artifact
// and returns a compact canonical JSON value. Empty evidence stays as {} so
// older attempts remain readable without fabricating a diagnostic result.
func NormalizeSubjectAttemptEvidence(questionSubject string, raw json.RawMessage) (json.RawMessage, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) || bytes.Equal(trimmed, []byte("{}")) {
		return json.RawMessage(`{}`), nil
	}
	if !json.Valid(trimmed) {
		return nil, errors.New("subject attempt evidence must be valid JSON")
	}

	var envelope subjectAttemptEvidenceEnvelope
	if err := decodeStrictJSON(trimmed, &envelope); err != nil {
		return nil, fmt.Errorf("subject attempt evidence: %w", err)
	}
	envelope.Subject = strings.ToLower(strings.TrimSpace(envelope.Subject))
	envelope.Tool = strings.ToLower(strings.TrimSpace(envelope.Tool))
	questionSubject = strings.ToLower(strings.TrimSpace(questionSubject))
	if envelope.Version != SubjectAttemptEvidenceVersion {
		return nil, fmt.Errorf("subject attempt evidence version must be %d", SubjectAttemptEvidenceVersion)
	}
	if envelope.Subject == "" || envelope.Subject != questionSubject {
		return nil, errors.New("subject attempt evidence subject must match the question")
	}
	tools, ok := subjectEvidenceTools[envelope.Subject]
	if !ok {
		return nil, fmt.Errorf("subject attempt evidence subject %q is unsupported", envelope.Subject)
	}
	if _, ok := tools[envelope.Tool]; !ok {
		return nil, fmt.Errorf("subject attempt evidence tool %q is invalid for %s", envelope.Tool, envelope.Subject)
	}
	if len(bytes.TrimSpace(envelope.Data)) == 0 || !json.Valid(envelope.Data) {
		return nil, errors.New("subject attempt evidence data must be valid JSON")
	}
	if err := validateSubjectEvidenceData(envelope.Tool, envelope.Data); err != nil {
		return nil, err
	}

	normalized, err := json.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("marshal subject attempt evidence: %w", err)
	}
	return normalized, nil
}

func validateSubjectEvidenceData(tool string, raw json.RawMessage) error {
	switch tool {
	case "scoring_points":
		var data struct {
			Points []string `json:"points"`
			Answer string   `json:"answer"`
		}
		if err := decodeStrictJSON(raw, &data); err != nil {
			return fmt.Errorf("scoring_points evidence: %w", err)
		}
		if len(nonEmptyStrings(data.Points)) == 0 || strings.TrimSpace(data.Answer) == "" {
			return errors.New("scoring_points evidence requires points and answer")
		}
	case "derivation":
		var data struct {
			Lines []string `json:"lines"`
		}
		if err := decodeStrictJSON(raw, &data); err != nil {
			return fmt.Errorf("derivation evidence: %w", err)
		}
		if len(nonEmptyStrings(data.Lines)) < 2 {
			return errors.New("derivation evidence requires at least two lines")
		}
	case "long_sentence":
		var data struct {
			Sentence string `json:"sentence"`
		}
		if err := decodeStrictJSON(raw, &data); err != nil {
			return fmt.Errorf("long_sentence evidence: %w", err)
		}
		if strings.TrimSpace(data.Sentence) == "" {
			return errors.New("long_sentence evidence requires a sentence")
		}
	case "free_body":
		var data struct {
			Forces []struct {
				ID        string   `json:"id"`
				Name      string   `json:"name"`
				Magnitude *float64 `json:"magnitude"`
				Angle     *float64 `json:"angle"`
				Kind      string   `json:"kind"`
			} `json:"forces"`
		}
		if err := decodeStrictJSON(raw, &data); err != nil {
			return fmt.Errorf("free_body evidence: %w", err)
		}
		if len(data.Forces) == 0 {
			return errors.New("free_body evidence requires at least one force")
		}
		for _, force := range data.Forces {
			if strings.TrimSpace(force.ID) == "" || strings.TrimSpace(force.Name) == "" ||
				(force.Kind != "contact" && force.Kind != "field") || force.Magnitude == nil || force.Angle == nil ||
				!finiteEvidenceNumber(*force.Magnitude) || *force.Magnitude < 0 ||
				!finiteEvidenceNumber(*force.Angle) {
				return errors.New("free_body evidence contains an invalid force")
			}
		}
	case "motion":
		var data struct {
			Stages []struct {
				ID      string   `json:"id"`
				Name    string   `json:"name"`
				V0      *float64 `json:"v0"`
				V       *float64 `json:"v"`
				A       *float64 `json:"a"`
				T       *float64 `json:"t"`
				X       *float64 `json:"x"`
				Derived []string `json:"derived"`
			} `json:"stages"`
		}
		if err := decodeStrictJSON(raw, &data); err != nil {
			return fmt.Errorf("motion evidence: %w", err)
		}
		if len(data.Stages) == 0 {
			return errors.New("motion evidence requires at least one stage")
		}
		for _, stage := range data.Stages {
			if strings.TrimSpace(stage.ID) == "" || strings.TrimSpace(stage.Name) == "" ||
				(stage.V0 != nil && !finiteMotionValue(*stage.V0)) ||
				(stage.V != nil && !finiteMotionValue(*stage.V)) ||
				(stage.A != nil && !finiteMotionValue(*stage.A)) ||
				(stage.T != nil && (*stage.T < 0 || !finiteMotionValue(*stage.T))) ||
				(stage.X != nil && !finiteMotionValue(*stage.X)) {
				return errors.New("motion evidence contains an invalid stage")
			}
			for _, quantity := range stage.Derived {
				if quantity != "v0" && quantity != "v" && quantity != "a" && quantity != "t" && quantity != "x" {
					return errors.New("motion evidence contains an invalid derived quantity")
				}
			}
		}
	case "equation":
		var data struct {
			Equation string `json:"equation"`
		}
		if err := decodeStrictJSON(raw, &data); err != nil {
			return fmt.Errorf("equation evidence: %w", err)
		}
		if strings.TrimSpace(data.Equation) == "" {
			return errors.New("equation evidence requires an equation")
		}
	case "causal_chain":
		var data struct {
			Links []struct {
				Cause  string `json:"cause"`
				Effect string `json:"effect"`
			} `json:"links"`
		}
		if err := decodeStrictJSON(raw, &data); err != nil {
			return fmt.Errorf("causal_chain evidence: %w", err)
		}
		if len(data.Links) == 0 {
			return errors.New("causal_chain evidence requires at least one link")
		}
		for _, link := range data.Links {
			if strings.TrimSpace(link.Cause) == "" || strings.TrimSpace(link.Effect) == "" {
				return errors.New("causal_chain evidence contains an incomplete link")
			}
		}
	}
	return nil
}

func decodeStrictJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}

func nonEmptyStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, value)
		}
	}
	return result
}

func finiteMotionValue(value float64) bool {
	return value >= -1e12 && value <= 1e12
}

func finiteEvidenceNumber(value float64) bool {
	return value == value && value >= -1e12 && value <= 1e12
}
