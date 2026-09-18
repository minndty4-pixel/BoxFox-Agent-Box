"""Start the loopback BoxFox harness using the repository's Python package."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend/src'))
from agentbox.api.server import main

if __name__ == '__main__':
    main()
