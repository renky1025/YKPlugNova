#!/bin/bash
set -e

HOST_NAME="com.signalfoundry.downloadapp"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/downloadapp_host.py"

# Resolve venv Python (project root is two levels above SCRIPT_DIR)
VENV_PYTHON="$(cd "$SCRIPT_DIR/../.." && pwd)/.venv/bin/python"

if [ -x "$VENV_PYTHON" ]; then
  echo "使用虚拟环境 Python: $VENV_PYTHON"
  # Update shebang so Chrome uses the venv interpreter
  sed -i.bak "1s|.*|#!$VENV_PYTHON|" "$HOST_SCRIPT" && rm -f "$HOST_SCRIPT.bak"
else
  echo "错误: 未找到虚拟环境 Python: $VENV_PYTHON"
  echo "请先在项目根目录创建虚拟环境并安装依赖:"
  echo "  cd $(cd "$SCRIPT_DIR/../.." && pwd)"
  echo "  python3 -m venv .venv"
  echo "  source .venv/bin/activate"
  echo "  pip install -r requirements.txt"
  exit 1
fi

detect_os() {
  case "$(uname -s)" in
    Darwin*) echo "macos" ;;
    Linux*)  echo "linux" ;;
    CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
    *)       echo "unknown" ;;
  esac
}

OS=$(detect_os)

if [ "$OS" = "unknown" ]; then
  echo "错误: 不支持的操作系统"
  exit 1
fi

if [ "$OS" = "windows" ]; then
  echo "Windows 安装说明:"
  echo "1. 将本目录下的 $HOST_NAME.json 中的 __HOST_PATH__ 替换为 downloadapp_host.py 的绝对路径"
  echo "2. 在注册表中添加 HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\$HOST_NAME"
  echo "   指向修改后的 JSON 文件"
  echo "3. 确保 Python 3 已安装并在 PATH 中"
  exit 0
fi

# macOS or Linux
if [ "$OS" = "macos" ]; then
  HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
else
  HOST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
fi

mkdir -p "$HOST_DIR"

# Replace __HOST_PATH__ with absolute path in the manifest
sed "s|__HOST_PATH__|$HOST_SCRIPT|g" "$SCRIPT_DIR/$HOST_NAME.json" > "$HOST_DIR/$HOST_NAME.json"

# Make host script executable
chmod +x "$HOST_SCRIPT"

echo "✅ Native host 已安装到:"
echo "   $HOST_DIR/$HOST_NAME.json"
echo ""
echo "扩展 ID: lnbmpcpenlogffmnbckimmoebnjbfnpb"
echo ""
echo "请确保:"
echo "  1. ffmpeg 和 yt-dlp 在 PATH 中"
echo ""
echo "安装完成后，在 Chrome 中加载扩展并点击图标即可使用。"
