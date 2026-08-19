package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizeLessonDocumentCanonicalizesSections(t *testing.T) {
	document, err := NormalizeLessonDocument(LessonDocument{Sections: []LessonSection{
		{Type: "follow_up", Content: json.RawMessage(`{"task":"复习"}`)},
		{Type: "diagnostic", Title: "自测", Content: json.RawMessage(`[]`)},
	}})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if document.SchemaVersion != LessonDocumentSchemaVersion || len(document.Sections) != 10 {
		t.Fatalf("document = %#v", document)
	}
	if document.Sections[0].Type != "diagnostic" || document.Sections[0].Title != "自测" || document.Sections[0].Position != 0 {
		t.Fatalf("diagnostic = %#v", document.Sections[0])
	}
	if document.Sections[9].Type != "follow_up" || string(document.Sections[9].Content) != `{"task":"复习"}` {
		t.Fatalf("follow up = %#v", document.Sections[9])
	}
}

func TestNormalizeLessonDocumentRejectsInvalidStructure(t *testing.T) {
	tests := []struct {
		name string
		doc  LessonDocument
		want string
	}{
		{name: "unknown", doc: LessonDocument{Sections: []LessonSection{{Type: "unknown"}}}, want: "unknown"},
		{name: "duplicate", doc: LessonDocument{Sections: []LessonSection{{Type: "concept"}, {Type: "concept"}}}, want: "duplicate"},
		{name: "invalid json", doc: LessonDocument{Sections: []LessonSection{{Type: "concept", Content: json.RawMessage("{")}}}, want: "valid JSON"},
		{name: "schema", doc: LessonDocument{SchemaVersion: 99}, want: "schema_version"},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := NormalizeLessonDocument(testCase.doc)
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("error = %v, want substring %q", err, testCase.want)
			}
		})
	}
}
