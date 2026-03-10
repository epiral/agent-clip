package internal

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// SkillMeta holds a skill's name and description (for listing/discovery).
type SkillMeta struct {
	Name        string
	Description string
}

func skillsDir() string {
	return filepath.Join(dataRoot(), "skills")
}

func skillPath(name string) string {
	return filepath.Join(skillsDir(), name+".md")
}

// ListSkills returns metadata for all skills in data/skills/.
func ListSkills() ([]SkillMeta, error) {
	dir := skillsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var skills []SkillMeta
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".md")
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		desc, _ := parseSkillFile(string(data))
		skills = append(skills, SkillMeta{Name: name, Description: desc})
	}
	return skills, nil
}

// LoadSkill reads a skill's full content.
func LoadSkill(name string) (description, body string, err error) {
	data, err := os.ReadFile(skillPath(name))
	if err != nil {
		return "", "", fmt.Errorf("skill %q not found", name)
	}
	desc, content := parseSkillFile(string(data))
	return desc, content, nil
}

// parseSkillFile splits YAML front matter from markdown body.
func parseSkillFile(raw string) (description, body string) {
	if !strings.HasPrefix(raw, "---\n") {
		return "", raw
	}
	end := strings.Index(raw[4:], "\n---")
	if end < 0 {
		return "", raw
	}
	frontMatter := raw[4 : 4+end]
	body = strings.TrimSpace(raw[4+end+4:])

	var meta struct {
		Description string `yaml:"description"`
	}
	_ = yaml.Unmarshal([]byte(frontMatter), &meta)
	return meta.Description, body
}

// writeSkillFile formats and writes a skill file.
func writeSkillFile(path, description, content string) error {
	var b strings.Builder
	fmt.Fprintf(&b, "---\ndescription: %q\n---\n\n%s\n", description, content)
	return os.WriteFile(path, []byte(b.String()), 0o644)
}

// EnsureSkillsDir copies seed skills to data/skills/ if the directory doesn't exist.
func EnsureSkillsDir() {
	dir := skillsDir()
	if _, err := os.Stat(dir); err == nil {
		return // already exists
	}

	os.MkdirAll(dir, 0o755)

	// Copy seed skills
	seedDir := filepath.Join(clipBase(), "seed", "skills")
	entries, err := os.ReadDir(seedDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(seedDir, e.Name()))
		if err != nil {
			continue
		}
		os.WriteFile(filepath.Join(dir, e.Name()), data, 0o644)
	}
}

// CreateSkill writes a new skill file.
func CreateSkill(name, description, content string) error {
	os.MkdirAll(skillsDir(), 0o755)
	path := skillPath(name)
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("skill %q already exists", name)
	}
	return writeSkillFile(path, description, content)
}

// UpdateSkill updates a skill's description and/or content.
func UpdateSkill(name string, newDesc, newContent *string) error {
	path := skillPath(name)
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("skill %q not found", name)
	}
	desc, body := parseSkillFile(string(data))
	if newDesc != nil {
		desc = *newDesc
	}
	if newContent != nil {
		body = *newContent
	}
	return writeSkillFile(path, desc, body)
}

// DeleteSkill removes a skill file.
func DeleteSkill(name string) error {
	path := skillPath(name)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("skill %q not found", name)
	}
	return os.Remove(path)
}

// RegisterSkillCommands adds skill commands to the registry.
func RegisterSkillCommands(r *Registry, cfg *Config) {
	skills, _ := ListSkills()

	var desc strings.Builder
	desc.WriteString("Reusable instructions. Match task → load → execute.\n")
	desc.WriteString("  skill list                       — list available skills\n")
	desc.WriteString("  skill load <name>                — load full instructions\n")
	desc.WriteString("  skill search <query>             — search skills by keyword\n")
	desc.WriteString("  skill create <name> --desc TEXT   — create (stdin=content)\n")
	desc.WriteString("  skill update <name> [--desc TEXT] — update (stdin=content)\n")
	desc.WriteString("  skill delete <name>              — delete a skill\n")

	if len(skills) > 0 {
		desc.WriteString("\nAvailable:\n")
		for _, s := range skills {
			fmt.Fprintf(&desc, "  %s — %s\n", s.Name, s.Description)
		}
	}

	r.Register("skill", desc.String(), func(args []string, stdin string) (string, error) {
		if len(args) == 0 {
			return "", fmt.Errorf("usage: skill list|load|search|create|update|delete")
		}

		switch args[0] {
		case "list":
			return skillListCmd()
		case "load":
			if len(args) < 2 {
				return "", fmt.Errorf("usage: skill load <name>")
			}
			return skillLoadCmd(args[1])
		case "search":
			if len(args) < 2 {
				return "", fmt.Errorf("usage: skill search <query>")
			}
			return skillSearchCmd(strings.Join(args[1:], " "))
		case "create":
			return skillCreateCmd(args[1:], stdin)
		case "update":
			return skillUpdateCmd(args[1:], stdin)
		case "delete":
			if len(args) < 2 {
				return "", fmt.Errorf("usage: skill delete <name>")
			}
			return skillDeleteCmd(args[1])
		default:
			return "", fmt.Errorf("unknown: skill %s. Use: list|load|search|create|update|delete", args[0])
		}
	})
}

func skillListCmd() (string, error) {
	skills, err := ListSkills()
	if err != nil {
		return "", err
	}
	if len(skills) == 0 {
		return "No skills. Use `skill create` to add one.", nil
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Skills (%d):\n", len(skills))
	for _, s := range skills {
		fmt.Fprintf(&b, "  %-20s %s\n", s.Name, s.Description)
	}
	return b.String(), nil
}

func skillLoadCmd(name string) (string, error) {
	desc, body, err := LoadSkill(name)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	fmt.Fprintf(&b, "<skill name=%q>\n", name)
	if desc != "" {
		fmt.Fprintf(&b, "> %s\n\n", desc)
	}
	b.WriteString(body)
	fmt.Fprintf(&b, "\n</skill>")
	return b.String(), nil
}

func skillSearchCmd(query string) (string, error) {
	skills, err := ListSkills()
	if err != nil {
		return "", err
	}
	if len(skills) == 0 {
		return "No skills.", nil
	}

	q := strings.ToLower(query)
	var matches []SkillMeta
	for _, s := range skills {
		if strings.Contains(strings.ToLower(s.Name), q) ||
			strings.Contains(strings.ToLower(s.Description), q) {
			matches = append(matches, s)
		}
	}

	if len(matches) == 0 {
		return fmt.Sprintf("No skills matching %q.", query), nil
	}

	var b strings.Builder
	for _, s := range matches {
		fmt.Fprintf(&b, "  %s — %s\n", s.Name, s.Description)
	}
	return b.String(), nil
}

func skillCreateCmd(args []string, stdin string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("usage: skill create <name> --desc \"description\"")
	}

	name := args[0]
	var description string
	for i := 1; i < len(args); i++ {
		if (args[i] == "--desc" || args[i] == "-d") && i+1 < len(args) {
			description = args[i+1]
			i++
		}
	}
	if description == "" {
		return "", fmt.Errorf("--desc is required")
	}
	if stdin == "" {
		return "", fmt.Errorf("content required via stdin")
	}

	path := skillPath(name)
	if _, err := os.Stat(path); err == nil {
		return "", fmt.Errorf("skill %q already exists. Use `skill update` to modify", name)
	}

	os.MkdirAll(skillsDir(), 0o755)
	if err := writeSkillFile(path, description, stdin); err != nil {
		return "", err
	}
	return fmt.Sprintf("Skill %q created. Use `skill load %s` to verify.", name, name), nil
}

func skillUpdateCmd(args []string, stdin string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("usage: skill update <name> [--desc \"new desc\"]")
	}

	name := args[0]
	desc, body, err := LoadSkill(name)
	if err != nil {
		return "", err
	}

	// Parse optional --desc flag
	for i := 1; i < len(args); i++ {
		if (args[i] == "--desc" || args[i] == "-d") && i+1 < len(args) {
			desc = args[i+1]
			i++
		}
	}

	if stdin != "" {
		body = stdin
	}

	if err := writeSkillFile(skillPath(name), desc, body); err != nil {
		return "", err
	}
	return fmt.Sprintf("Skill %q updated.", name), nil
}

func skillDeleteCmd(name string) (string, error) {
	path := skillPath(name)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return "", fmt.Errorf("skill %q not found", name)
	}
	if err := os.Remove(path); err != nil {
		return "", err
	}
	return fmt.Sprintf("Skill %q deleted.", name), nil
}
