package internal

import (
	"encoding/base64"
	"path/filepath"
	"strings"
)

const defaultImageMIME = "image/png"

var imageMIMETypes = map[string]string{
	".bmp":  "image/bmp",
	".gif":  "image/gif",
	".ico":  "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg":  "image/jpeg",
	".png":  "image/png",
	".svg":  "image/svg+xml",
	".webp": "image/webp",
}

func IsImageFile(path string) bool {
	_, ok := imageMIMETypes[strings.ToLower(filepath.Ext(path))]
	return ok
}

func imageMIMEType(path string) string {
	if mimeType, ok := imageMIMETypes[strings.ToLower(filepath.Ext(path))]; ok {
		return mimeType
	}
	return defaultImageMIME
}

func imageDataFromBytes(path string, data []byte) ImageData {
	return ImageData{
		Base64:   base64.StdEncoding.EncodeToString(data),
		MimeType: imageMIMEType(path),
	}
}
