"""
Template Parser - Loads and validates YAML operation templates
"""
import yaml
from pathlib import Path
from typing import Any, Dict, List, Optional


class TemplateParser:
    """Parses and validates operation templates"""
    
    def __init__(self, repo_root: str):
        self.repo_root = Path(repo_root)
        self.operations_dir = self.repo_root / "operations"
    
    def load_template(self, template_path: str) -> Dict[str, Any]:
        """
        Load operation template from YAML file
        template_path can be:
        - Relative: "deploy/mcp-server.yml"
        - Absolute: "/full/path/to/template.yml"
        - Template name: "deploy_mcp_server" (converted to deploy/mcp-server.yml)
        """
        # Convert template name to path
        if '/' not in template_path and '.' not in template_path:
            # It's a template name like "deploy_mcp_server"
            parts = template_path.split('_', 1)
            if len(parts) == 2:
                template_path = f"{parts[0]}/{parts[1].replace('_', '-')}.yml"
        
        # Make absolute if relative
        if not Path(template_path).is_absolute():
            template_path = self.operations_dir / template_path
        else:
            template_path = Path(template_path)
        
        if not template_path.exists():
            raise FileNotFoundError(f"Template not found: {template_path}")
        
        with open(template_path, 'r') as f:
            template = yaml.safe_load(f)
        
        self._validate_template(template)
        
        return template
    
    def _validate_template(self, template: Dict[str, Any]) -> None:
        """Validate template structure"""
        required_keys = ['operation', 'parameters', 'steps']
        for key in required_keys:
            if key not in template:
                raise ValueError(f"Template missing required key: {key}")
        
        operation = template['operation']
        required_op_keys = ['name', 'type', 'description']
        for key in required_op_keys:
            if key not in operation:
                raise ValueError(f"operation missing required key: {key}")
        
        if operation['type'] not in ['deploy', 'maintain', 'recovery']:
            raise ValueError(f"Invalid operation type: {operation['type']}")
        
        # Validate steps
        steps = template.get('steps', [])
        if not isinstance(steps, list):
            raise ValueError("steps must be a list")
        
        for i, step in enumerate(steps):
            if not isinstance(step, dict):
                raise ValueError(f"Step {i} must be a dict")
            if 'name' not in step:
                raise ValueError(f"Step {i} missing 'name'")
            if 'type' not in step:
                raise ValueError(f"Step {i} missing 'type'")
    
    def substitute_variables(
        self, 
        template: Dict[str, Any],
        variables: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Substitute variables in template
        Variables format: ${variable_name}
        """
        import json
        from datetime import datetime
        
        # Add built-in variables
        built_in_vars = {
            'current_date': datetime.utcnow().strftime('%Y-%m-%d'),
            'current_timestamp': datetime.utcnow().isoformat() + 'Z',
            'current_time': datetime.utcnow().strftime('%H:%M:%S'),
        }
        
        all_vars = {**built_in_vars, **variables}
        
        # Convert template to JSON string for easy substitution
        template_str = json.dumps(template)
        
        # Substitute each variable
        for key, value in all_vars.items():
            template_str = template_str.replace(f"${{{key}}}", str(value))
        
        # Convert back to dict
        return json.loads(template_str)
    
    def get_required_parameters(self, template: Dict[str, Any]) -> List[str]:
        """Get list of required parameters (those without defaults)"""
        parameters = template.get('parameters', {})
        required = []
        
        for param_name, param_value in parameters.items():
            # If value is empty string or None, it's required
            if param_value == "" or param_value is None:
                required.append(param_name)
        
        return required
    
    def validate_parameters(
        self, 
        template: Dict[str, Any],
        provided: Dict[str, Any]
    ) -> None:
        """Validate that all required parameters are provided"""
        required = self.get_required_parameters(template)
        
        for param in required:
            if param not in provided or provided[param] == "":
                raise ValueError(f"Missing required parameter: {param}")
    
    def merge_parameters(
        self,
        template: Dict[str, Any],
        provided: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Merge provided parameters with template defaults
        Provided parameters override defaults
        """
        defaults = template.get('parameters', {})
        merged = {**defaults, **provided}
        
        return merged
