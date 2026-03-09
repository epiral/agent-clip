package internal

import (
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
	BaseURL string `yaml:"base_url"`
	APIKey  string `yaml:"api_key"`
}

type ClipConfig struct {
	Name     string   `yaml:"name" json:"name"`
	URL      string   `yaml:"url" json:"url"`
	Token    string   `yaml:"token" json:"-"`
	Commands []string `yaml:"commands,omitempty" json:"commands,omitempty"`
}

type BrowserConfig struct {
	Endpoint string `yaml:"endpoint"`
}

type Config struct {
	Name      string                     `yaml:"name"` // agent name, e.g. "pi"
	Providers map[string]ProviderConfig `yaml:"providers"`

	LLMProvider string `yaml:"llm_provider"`
	LLMModel    string `yaml:"llm_model"`

	EmbeddingProvider string `yaml:"embedding_provider"`
	EmbeddingModel    string `yaml:"embedding_model"`

	SystemPrompt string         `yaml:"system_prompt"`
	Clips        []ClipConfig   `yaml:"clips,omitempty"`
	Browser      *BrowserConfig `yaml:"browser,omitempty"`
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
	// env override: OPENROUTER_API_KEY, BAILIAN_API_KEY, etc.
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

// ConfigGet returns a human-readable summary of the current config.
func ConfigGet(cfg *Config) string {
	var b strings.Builder
	fmt.Fprintf(&b, "name: %s\n", cfg.Name)
	fmt.Fprintf(&b, "llm_provider: %s\n", cfg.LLMProvider)
	fmt.Fprintf(&b, "llm_model: %s\n", cfg.LLMModel)
	fmt.Fprintf(&b, "embedding_provider: %s\n", cfg.EmbeddingProvider)
	fmt.Fprintf(&b, "embedding_model: %s\n", cfg.EmbeddingModel)
	fmt.Fprintf(&b, "providers: %s\n", strings.Join(providerNames(cfg), ", "))
	if cfg.Browser != nil && cfg.Browser.Endpoint != "" {
		fmt.Fprintf(&b, "browser: %s\n", cfg.Browser.Endpoint)
	}
	if len(cfg.Clips) > 0 {
		for _, c := range cfg.Clips {
			fmt.Fprintf(&b, "clip: %s (%s)\n", c.Name, strings.Join(c.Commands, ", "))
		}
	}
	return b.String()
}

func providerNames(cfg *Config) []string {
	names := make([]string, 0, len(cfg.Providers))
	for k := range cfg.Providers {
		names = append(names, k)
	}
	return names
}

// ConfigSet sets a flat key in the config file using raw YAML manipulation.
func ConfigSet(key, value string) error {
	raw, err := os.ReadFile(configPath())
	if err != nil {
		return fmt.Errorf("read config: %w", err)
	}

	// parse into ordered map to preserve structure
	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 {
		return fmt.Errorf("invalid config format")
	}
	mapping := doc.Content[0]
	if mapping.Kind != yaml.MappingNode {
		return fmt.Errorf("config root is not a mapping")
	}

	// find and update the key
	found := false
	for i := 0; i < len(mapping.Content)-1; i += 2 {
		if mapping.Content[i].Value == key {
			mapping.Content[i+1] = &yaml.Node{Kind: yaml.ScalarNode, Value: value, Tag: "!!str"}
			found = true
			break
		}
	}

	if !found {
		// insert before system_prompt (or at end)
		keyNode := &yaml.Node{Kind: yaml.ScalarNode, Value: key, Tag: "!!str"}
		valNode := &yaml.Node{Kind: yaml.ScalarNode, Value: value, Tag: "!!str"}
		insertIdx := len(mapping.Content)
		for i := 0; i < len(mapping.Content)-1; i += 2 {
			if mapping.Content[i].Value == "system_prompt" {
				insertIdx = i
				break
			}
		}
		newContent := make([]*yaml.Node, 0, len(mapping.Content)+2)
		newContent = append(newContent, mapping.Content[:insertIdx]...)
		newContent = append(newContent, keyNode, valNode)
		newContent = append(newContent, mapping.Content[insertIdx:]...)
		mapping.Content = newContent
	}

	out, err := yaml.Marshal(&doc)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	return os.WriteFile(configPath(), out, 0o644)
}

// RegisterConfigCommands adds config management to the run tool registry.
func RegisterConfigCommands(r *Registry) {
	r.Register("config", `View or update agent configuration.
  config                           — show current config
  config set <key> <value>         — set a config value
  Keys: name, llm_provider, llm_model, embedding_provider, embedding_model`,
		func(args []string, stdin string) (string, error) {
			if len(args) == 0 {
				cfg, err := LoadConfig()
				if err != nil {
					return "", err
				}
				return ConfigGet(cfg), nil
			}

			if args[0] == "set" {
				if len(args) < 3 {
					return "", fmt.Errorf("usage: config set <key> <value>")
				}
				key := args[1]
				value := strings.Join(args[2:], " ")
				if err := ConfigSet(key, value); err != nil {
					return "", err
				}
				return fmt.Sprintf("%s = %s", key, value), nil
			}

			return "", fmt.Errorf("usage: config [set <key> <value>]")
		})
}
