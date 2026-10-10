package adminsystem

import (
	"path"
	"strings"
)

const aiLogBodyHiddenMarker = "[REDACTED: AI/MCP 正文内容已隐藏]"

// isAILogSensitivePath accepts only the built-in AI namespace, including slash-normalized children.
// It uses URL.Path, not the request URL or caller-provided query parameters.
func isAILogSensitivePath(requestPath string) bool {
	clean := path.Clean("/" + requestPath)
	const prefix = "/admin/developer/ai"
	return clean == prefix || strings.HasPrefix(clean, prefix+"/")
}

// operationLogBodies never reads or formats AI bodies. The collector is only used for other interfaces.
func operationLogBodies(requestPath string, collect func() (any, any)) (any, any) {
	if isAILogSensitivePath(requestPath) {
		return aiLogBodyHiddenMarker, aiLogBodyHiddenMarker
	}
	return collect()
}
