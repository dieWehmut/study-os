package httpapi

import (
	"encoding/json"
	"strings"

	"study-os/backend/models"
)

type noteCard struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type noteMapNode struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	ParentID string `json:"parent_id"`
	NodeType string `json:"node_type"`
}

type noteMap struct {
	Title string        `json:"title"`
	Nodes []noteMapNode `json:"nodes"`
}

// lessonDocumentFromNote fills the two sections an integrated note can answer:
// 核心概念 from its cards, 可视化 from its map. Everything else stays the empty
// ten-section template -- a draft lesson that claims nothing it was not given.
//
// This lives on the server so a lesson made from a note is the same lesson
// whichever client asked for it: the note already holds the cards and the map,
// and how those become sections is one decision, not one per caller.
func lessonDocumentFromNote(note models.IntegratedNote) models.LessonDocument {
	document := models.NewLessonDocument()

	var cards []noteCard
	_ = json.Unmarshal(note.CardsJSON, &cards)
	concept := make([]string, 0, len(cards))
	for _, card := range cards {
		title := strings.TrimSpace(card.Title)
		body := strings.TrimSpace(card.Body)
		// 速度：速度描述运动的快慢。 repeats itself. A model's card often opens
		// its body with the title it was given, so the body is used whole unless
		// the title says something the body does not.
		line := title + "：" + body
		switch {
		case body == "":
			line = title
		case title == "" || strings.HasPrefix(body, title):
			line = body
		}
		if strings.TrimSpace(line) != "" {
			concept = append(concept, strings.TrimSpace(line))
		}
	}
	if len(concept) > 0 {
		setLessonSection(document, "concept", map[string]any{"items": concept})
	}

	var noteMindMap noteMap
	if err := json.Unmarshal(note.MindmapJSON, &noteMindMap); err == nil {
		if outline := mindMapOutline(noteMindMap); strings.TrimSpace(outline) != "" {
			setLessonSection(document, "visualization", map[string]any{"markdown": outline})
		}
	}
	return document
}

// mindMapOutline writes a flat node list back out as an indented markdown list.
//
// The map is stored flat (id + parent_id), so the tree is rebuilt here. Visited
// ids guard the walk: a corrupt or self-referencing row must not spin forever.
func mindMapOutline(mindMap noteMap) string {
	children := make(map[string][]noteMapNode, len(mindMap.Nodes))
	known := make(map[string]bool, len(mindMap.Nodes))
	for _, node := range mindMap.Nodes {
		known[node.ID] = true
	}
	roots := make([]noteMapNode, 0, 1)
	for _, node := range mindMap.Nodes {
		if node.ParentID == "" || !known[node.ParentID] || node.ParentID == node.ID {
			roots = append(roots, node)
			continue
		}
		children[node.ParentID] = append(children[node.ParentID], node)
	}
	if len(roots) == 0 {
		return ""
	}

	lines := make([]string, 0, len(mindMap.Nodes))
	visited := make(map[string]bool, len(mindMap.Nodes))
	var walk func(node noteMapNode, depth int)
	walk = func(node noteMapNode, depth int) {
		if visited[node.ID] {
			return
		}
		visited[node.ID] = true
		label := strings.TrimSpace(node.Label)
		if label == "" {
			label = strings.TrimSpace(node.ID)
		}
		if label != "" {
			lines = append(lines, strings.Repeat("  ", depth)+"- "+label)
		}
		for _, child := range children[node.ID] {
			walk(child, depth+1)
		}
	}
	for _, root := range roots {
		walk(root, 0)
	}
	return strings.Join(lines, "\n")
}

func setLessonSection(document models.LessonDocument, sectionType string, content any) {
	encoded, err := json.Marshal(content)
	if err != nil {
		return
	}
	for index := range document.Sections {
		if document.Sections[index].Type == sectionType {
			document.Sections[index].Content = encoded
			return
		}
	}
}
