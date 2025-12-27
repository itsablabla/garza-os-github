"""
State Manager - Handles infrastructure state files
Reads/writes JSON state with atomic operations
"""
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional


class StateManager:
    """Manages infrastructure state stored in JSON files"""
    
    def __init__(self, repo_root: str):
        self.repo_root = Path(repo_root)
        self.state_dir = self.repo_root / "infra" / "state"
        
    def read_state(self, file: str) -> Dict[str, Any]:
        """Read entire state file"""
        file_path = self.state_dir / file
        if not file_path.exists():
            return {}
        
        with open(file_path, 'r') as f:
            return json.load(f)
    
    def write_state(self, file: str, data: Dict[str, Any]) -> None:
        """Write entire state file atomically"""
        file_path = self.state_dir / file
        
        # Write to temp file first
        temp_path = file_path.with_suffix('.tmp')
        with open(temp_path, 'w') as f:
            json.dump(data, f, indent=2)
        
        # Atomic rename
        temp_path.replace(file_path)
    
    def get_value(self, file: str, path: str) -> Optional[Any]:
        """
        Get value from state using JSON path notation
        Example: ".fly_apps.garza-home-mcp.status"
        """
        data = self.read_state(file)
        
        # Parse path (remove leading dot)
        keys = path.lstrip('.').split('.')
        
        current = data
        for key in keys:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return None
        
        return current
    
    def set_value(self, file: str, path: str, value: Any) -> None:
        """
        Set value in state using JSON path notation
        Creates intermediate objects if needed
        """
        data = self.read_state(file)
        
        # Parse path (remove leading dot)
        keys = path.lstrip('.').split('.')
        
        # Navigate to parent
        current = data
        for key in keys[:-1]:
            if key not in current:
                current[key] = {}
            current = current[key]
        
        # Set final value
        current[keys[-1]] = value
        
        self.write_state(file, data)
    
    def update_values(self, file: str, updates: Dict[str, Any]) -> None:
        """
        Update multiple values in state
        Example: {
            ".fly_apps.garza-home-mcp.status": "running",
            ".fly_apps.garza-home-mcp.last_deploy": "2025-12-27"
        }
        """
        data = self.read_state(file)
        
        for path, value in updates.items():
            # Parse path
            keys = path.lstrip('.').split('.')
            
            # Navigate to parent
            current = data
            for key in keys[:-1]:
                # Handle wildcard matching
                if key == '*':
                    # Find first matching key
                    for k in current.keys():
                        if isinstance(current[k], dict):
                            current = current[k]
                            break
                else:
                    if key not in current:
                        current[key] = {}
                    current = current[key]
            
            # Set final value
            final_key = keys[-1]
            if final_key == '*':
                # Update all matching keys
                for k in current.keys():
                    current[k] = value
            else:
                current[final_key] = value
        
        self.write_state(file, data)
    
    def append_operation(self, operation_data: Dict[str, Any]) -> None:
        """Append operation to operations.json log"""
        ops_file = "operations.json"
        data = self.read_state(ops_file)
        
        if "operations" not in data:
            data["operations"] = []
        
        data["operations"].append(operation_data)
        
        # Keep only last 1000 operations
        if len(data["operations"]) > 1000:
            data["operations"] = data["operations"][-1000:]
        
        self.write_state(ops_file, data)
