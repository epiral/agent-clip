package internal

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

func clipBase() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(filepath.Dir(exe))
}

type ProviderConfig struct {
	Protocol string `yaml:"protocol" json:"protocol"` // "openai" (default) | "anthropic"
	BaseURL  string `yaml:"base_url" json:"base_url"`
	APIKey   string `yaml:"api_key" json:"api_key"`
}

type ClipConfig struct {
	Name     string   `yaml:"name" json:"name"`
	URL      string   `yaml:"url" json:"url"`
	Token    string   `yaml:"token" json:"-"`
	Commands []string `yaml:"commands,omitempty" json:"commands,omitempty"` // fallback if GetInfo unavailable

	// Runtime: populated by ProbeClips(), not serialized
	Manifest *ClipManifest `yaml:"-" json:"-"`
}

type BrowserConfig struct {
	Endpoint string `yaml:"endpoint" json:"endpoint"`
}

type Config struct {
	Name      string                    `yaml:"name" json:"name"`
	Providers map[string]ProviderConfig `yaml:"providers" json:"providers"`

	LLMProvider string `yaml:"llm_provider" json:"llm_provider"`
	LLMModel    string `yaml:"llm_model" json:"llm_model"`

	EmbeddingProvider string `yaml:"embedding_provider" json:"embedding_provider"`
	EmbeddingModel    string `yaml:"embedding_model" json:"embedding_model"`

	SystemPrompt string         `yaml:"system_prompt" json:"system_prompt"`
	Clips        []ClipConfig   `yaml:"clips,omitempty" json:"clips"`
	Browser      *BrowserConfig `yaml:"browser,omitempty" json:"browser,omitempty"`
}

type ConfigJSON struct {
	Name              string                  `json:"name"`
	Providers         map[string]ProviderJSON `json:"providers"`
	LLMProvider       string                  `json:"llm_provider"`
	LLMModel          string                  `json:"llm_model"`
	EmbeddingProvider string                  `json:"embedding_provider"`
	EmbeddingModel    string                  `json:"embedding_model"`
	SystemPrompt      string                  `json:"system_prompt"`
	Clips             []ClipJSON              `json:"clips"`
	Browser           *BrowserConfigJSON      `json:"browser,omitempty"`
}

type ProviderJSON struct {
	Protocol string `json:"protocol"`
	BaseURL  string `json:"base_url"`
	APIKey   string `json:"api_key"`
}

type ClipJSON struct {
	Name     string   `json:"name"`
	URL      string   `json:"url"`
	Token    string   `json:"token"`
	Commands []string `json:"commands,omitempty"`
}

type BrowserConfigJSON struct {
	Endpoint string `json:"endpoint"`
}

func (c *Config) GetLLMProvider() (*ProviderConfig, error) {
	return c.getProvider(c.LLMProvider)
}

func (c *Config) GetEmbeddingProvider() (*ProviderConfig, error) {
	return c.getProvider(c.EmbeddingProvider)
}

func (c *Config) getProvider(name string) (*ProviderConfig, error) {
	p, ok := c.Providers[name]
	if !ok {
		return nil, fmt.Errorf("provider %q not found in config", name)
	}
	envKey := os.Getenv("OPENROUTER_API_KEY")
	if envKey != "" && name == "openrouter" {
		p.APIKey = envKey
	}
	return &p, nil
}

func (c *Config) GetClip(name string) *ClipConfig {
	for i := range c.Clips {
		if c.Clips[i].Name == name {
			return &c.Clips[i]
		}
	}
	return nil
}

func configPath() string {
	return filepath.Join(clipBase(), "data", "config.yaml")
}

func LoadConfig() (*Config, error) {
	raw, err := os.ReadFile(configPath())
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return &cfg, nil
}

// --- Read ---

// ConfigGetJSON returns config as a JSON-serializable map with sensitive fields masked.
func ConfigGetJSON(cfg *Config) ConfigJSON {
	providers := make(map[string]ProviderJSON, len(cfg.Providers))
	for name, p := range cfg.Providers {
		providers[name] = ProviderJSON{Protocol: p.Protocol, BaseURL: p.BaseURL, APIKey: maskSecret(p.APIKey)}
	}

	clips := make([]ClipJSON, 0, len(cfg.Clips))
	for _, c := range cfg.Clips {
		clips = append(clips, ClipJSON{Name: c.Name, URL: c.URL, Token: maskSecret(c.Token), Commands: c.Commands})
	}

	result := ConfigJSON{
		Name:              cfg.Name,
		Providers:         providers,
		LLMProvider:       cfg.LLMProvider,
		LLMModel:          cfg.LLMModel,
		EmbeddingProvider: cfg.EmbeddingProvider,
		EmbeddingModel:    cfg.EmbeddingModel,
		SystemPrompt:      cfg.SystemPrompt,
		Clips:             clips,
	}

	if cfg.Browser != nil {
		result.Browser = &BrowserConfigJSON{Endpoint: cfg.Browser.Endpoint}
	}

	return result
}

// ConfigGetText returns a concise text summary (for LLM tool use).
func ConfigGetText(cfg *Config) string {
	var b strings.Builder
	fmt.Fprintf(&b, "name: %s\n", cfg.Name)
	fmt.Fprintf(&b, "llm_provider: %s\n", cfg.LLMProvider)
	fmt.Fprintf(&b, "llm_model: %s\n", cfg.LLMModel)
	fmt.Fprintf(&b, "embedding_provider: %s\n", cfg.EmbeddingProvider)
	fmt.Fprintf(&b, "embedding_model: %s\n", cfg.EmbeddingModel)
	names := make([]string, 0, len(cfg.Providers))
	for k := range cfg.Providers {
		names = append(names, k)
	}
	fmt.Fprintf(&b, "providers: %s\n", strings.Join(names, ", "))
	if cfg.Browser != nil && cfg.Browser.Endpoint != "" {
		fmt.Fprintf(&b, "browser: %s\n", cfg.Browser.Endpoint)
	}
	for _, c := range cfg.Clips {
		fmt.Fprintf(&b, "clip: %s (%s)\n", c.Name, strings.Join(c.Commands, ", "))
	}
	return b.String()
}

func maskSecret(s string) string {
	if s == "" {
		return ""
	}
	if len(s) <= 8 {
		return "****"
	}
	return "****" + s[len(s)-4:]
}

// --- Write (dot-path) ---

// ConfigSet sets a value at a dot-separated path (e.g., "providers.openrouter.api_key").
func ConfigSet(dotPath, value string) error {
	raw, err := os.ReadFile(configPath())
	if err != nil {
		return fmt.Errorf("read config: %w", err)
	}

	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 {
		return fmt.Errorf("invalid config format")
	}

	parts := strings.Split(dotPath, ".")
	if err := yamlSetPath(doc.Content[0], parts, value); err != nil {
		return fmt.Errorf("set %s: %w", dotPath, err)
	}

	out, err := yaml.Marshal(&doc)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	return os.WriteFile(configPath(), out, 0o644)
}

func yamlSetPath(node *yaml.Node, parts []string, value string) error {
	if node.Kind != yaml.MappingNode {
		return fmt.Errorf("expected mapping node")
	}

	key := parts[0]

	// Find existing key
	for i := 0; i < len(node.Content)-1; i += 2 {
		if node.Content[i].Value == key {
			if len(parts) == 1 {
				node.Content[i+1] = &yaml.Node{Kind: yaml.ScalarNode, Value: value, Tag: "!!str"}
				return nil
			}
			return yamlSetPath(node.Content[i+1], parts[1:], value)
		}
	}

	// Key not found — create
	if len(parts) == 1 {
		node.Content = append(node.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Value: key, Tag: "!!str"},
			&yaml.Node{Kind: yaml.ScalarNode, Value: value, Tag: "!!str"},
		)
		return nil
	}

	newMapping := &yaml.Node{Kind: yaml.MappingNode}
	node.Content = append(node.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Value: key, Tag: "!!str"},
		newMapping,
	)
	return yamlSetPath(newMapping, parts[1:], value)
}

// --- Delete (dot-path) ---

// ConfigDelete removes a key at a dot-separated path.
func ConfigDelete(dotPath string) error {
	raw, err := os.ReadFile(configPath())
	if err != nil {
		return fmt.Errorf("read config: %w", err)
	}

	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 {
		return fmt.Errorf("invalid config format")
	}

	parts := strings.Split(dotPath, ".")
	if err := yamlDeletePath(doc.Content[0], parts); err != nil {
		return fmt.Errorf("delete %s: %w", dotPath, err)
	}

	out, err := yaml.Marshal(&doc)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	return os.WriteFile(configPath(), out, 0o644)
}

func yamlDeletePath(node *yaml.Node, parts []string) error {
	if node.Kind != yaml.MappingNode {
		return fmt.Errorf("expected mapping node")
	}

	key := parts[0]
	for i := 0; i < len(node.Content)-1; i += 2 {
		if node.Content[i].Value == key {
			if len(parts) == 1 {
				node.Content = append(node.Content[:i], node.Content[i+2:]...)
				return nil
			}
			return yamlDeletePath(node.Content[i+1], parts[1:])
		}
	}
	return fmt.Errorf("key %q not found", key)
}

// --- Clip management ---

// clipInput mirrors ClipConfig but allows JSON unmarshaling of token.
type clipInput struct {
	Name     string   `json:"name"`
	URL      string   `json:"url"`
	Token    string   `json:"token"`
	Commands []string `json:"commands,omitempty"`
}

func ParseClipInput(jsonStr string) (ClipConfig, error) {
	var input clipInput
	if err := json.Unmarshal([]byte(jsonStr), &input); err != nil {
		return ClipConfig{}, fmt.Errorf("parse clip JSON: %w", err)
	}
	return ClipConfig{
		Name:     input.Name,
		URL:      input.URL,
		Token:    input.Token,
		Commands: input.Commands,
	}, nil
}

// ConfigAddClip adds a clip connection. Uses struct-based save (may reformat YAML).
func ConfigAddClip(clip ClipConfig) error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}

	for _, c := range cfg.Clips {
		if c.Name == clip.Name {
			return fmt.Errorf("clip %q already exists", clip.Name)
		}
	}

	cfg.Clips = append(cfg.Clips, clip)
	return saveConfig(cfg)
}

// ConfigRemoveClip removes a clip by name.
func ConfigRemoveClip(name string) error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}

	filtered := make([]ClipConfig, 0, len(cfg.Clips))
	found := false
	for _, c := range cfg.Clips {
		if c.Name == name {
			found = true
			continue
		}
		filtered = append(filtered, c)
	}
	if !found {
		return fmt.Errorf("clip %q not found", name)
	}

	cfg.Clips = filtered
	return saveConfig(cfg)
}

func saveConfig(cfg *Config) error {
	out, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	return os.WriteFile(configPath(), out, 0o644)
}

// --- LLM tool registration ---

func RegisterConfigCommands(r *Registry) {
	r.Register("config", `View or update agent configuration.
  config                                    — show current config
  config set <key> <value>                  — set a value (supports dot-path: providers.openrouter.api_key)
  config delete <key>                       — delete a key (e.g., providers.minimax)
  config add-clip <json>                    — add clip: {"name":"x","url":"...","token":"...","commands":["bash"]}
  config remove-clip <name>                 — remove a clip`,
		func(args []string, stdin string) (string, error) {
			if len(args) == 0 {
				cfg, err := LoadConfig()
				if err != nil {
					return "", err
				}
				return ConfigGetText(cfg), nil
			}

			switch args[0] {
			case "set":
				if len(args) < 3 {
					return "", fmt.Errorf("usage: config set <key> <value>")
				}
				key := args[1]
				value := strings.Join(args[2:], " ")
				if err := ConfigSet(key, value); err != nil {
					return "", err
				}
				return fmt.Sprintf("%s = %s", key, value), nil

			case "delete":
				if len(args) < 2 {
					return "", fmt.Errorf("usage: config delete <key>")
				}
				if err := ConfigDelete(args[1]); err != nil {
					return "", err
				}
				return fmt.Sprintf("deleted %s", args[1]), nil

			case "add-clip":
				jsonStr := strings.Join(args[1:], " ")
				if jsonStr == "" {
					jsonStr = stdin
				}
				clip, err := ParseClipInput(jsonStr)
				if err != nil {
					return "", err
				}
				if clip.Name == "" || clip.URL == "" {
					return "", fmt.Errorf("clip requires name and url")
				}
				if err := ConfigAddClip(clip); err != nil {
					return "", err
				}
				return fmt.Sprintf("added clip %s", clip.Name), nil

			case "remove-clip":
				if len(args) < 2 {
					return "", fmt.Errorf("usage: config remove-clip <name>")
				}
				if err := ConfigRemoveClip(args[1]); err != nil {
					return "", err
				}
				return fmt.Sprintf("removed clip %s", args[1]), nil
			}

			return "", fmt.Errorf("unknown config subcommand: %s", args[0])
		})
}
