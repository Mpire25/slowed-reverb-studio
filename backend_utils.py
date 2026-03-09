import re

_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
_YTDLP_PREFIX_RE = re.compile(r'^(ERROR|WARNING):\s*(\[[^\]]+\]\s*)?', re.IGNORECASE)


def clean_error_message(msg: str) -> str:
    cleaned = _ANSI_RE.sub('', msg).strip()
    cleaned = cleaned.splitlines()[0].strip() if cleaned else cleaned
    return _YTDLP_PREFIX_RE.sub('', cleaned).strip()
