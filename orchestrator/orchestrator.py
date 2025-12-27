"""
Orchestrator - Main execution engine for operation templates
Coordinates template parsing, step execution, rollback, and notifications
"""
from pathlib import Path
from typing import Any, Dict, Optional
from datetime import datetime

from core.template_parser import TemplateParser
from managers.state_manager import StateManager
from managers.lock_manager import LockManager
from executors.step_executor import StepExecutor


class Orchestrator:
    """Executes operation templates with error handling and rollback"""
    
    def __init__(self, repo_root: str = "/Users/customer/garza-os-github"):
        self.repo_root = Path(repo_root)
        
        # Initialize managers
        self.template_parser = TemplateParser(str(self.repo_root))
        self.state_manager = StateManager(str(self.repo_root))
        self.lock_manager = LockManager(str(self.repo_root))
        
        # Initialize executor
        self.step_executor = StepExecutor(
            str(self.repo_root),
            self.lock_manager,
            self.state_manager
        )
        
        # Execution state
        self.current_operation = None
        self.execution_log = []
    
    def execute(
        self,
        template_path: str,
        parameters: Optional[Dict[str, Any]] = None,
        dry_run: bool = False
    ) -> tuple[bool, Dict[str, Any]]:
        """
        Execute an operation template
        
        Args:
            template_path: Path to template or template name
            parameters: Parameter values to override
            dry_run: If True, only validate without executing
        
        Returns:
            (success, result_data)
        """
        if parameters is None:
            parameters = {}
        
        start_time = datetime.utcnow()
        
        try:
            # Load template
            print(f"[INFO] Loading template: {template_path}")
            template = self.template_parser.load_template(template_path)
            
            operation = template['operation']
            print(f"[INFO] Operation: {operation['name']} ({operation['type']})")
            print(f"[INFO] Description: {operation['description']}")
            
            # Validate and merge parameters
            self.template_parser.validate_parameters(template, parameters)
            merged_params = self.template_parser.merge_parameters(template, parameters)
            
            # Substitute variables
            template = self.template_parser.substitute_variables(template, merged_params)
            
            if dry_run:
                print("[INFO] Dry run - would execute:")
                for i, step in enumerate(template['steps'], 1):
                    print(f"  {i}. {step['name']} ({step['type']})")
                return True, {"dry_run": True}
            
            # Check prerequisites
            if not self._check_prerequisites(template):
                raise Exception("Prerequisites check failed")
            
            # Execute steps
            print(f"\n[INFO] Executing {len(template['steps'])} steps...")
            
            success = self._execute_steps(template['steps'], merged_params)
            
            if not success:
                # Run rollback if configured
                if template.get('rollback', {}).get('enabled', True):
                    print("\n[WARN] Execution failed - running rollback...")
                    self._execute_rollback(template, merged_params)
                
                raise Exception("Operation failed")
            
            # Send success notifications
            self._send_notifications(template, 'on_success', merged_params)
            
            end_time = datetime.utcnow()
            duration = (end_time - start_time).total_seconds()
            
            result = {
                "success": True,
                "operation": operation['name'],
                "duration_seconds": duration,
                "timestamp": end_time.isoformat() + 'Z'
            }
            
            print(f"\n[SUCCESS] Operation completed in {duration:.1f}s")
            
            return True, result
            
        except Exception as e:
            print(f"\n[ERROR] Operation failed: {e}")
            
            # Send failure notifications
            if 'template' in locals():
                self._send_notifications(
                    template, 
                    'on_failure', 
                    {**merged_params, 'error_message': str(e)}
                )
            
            end_time = datetime.utcnow()
            duration = (end_time - start_time).total_seconds()
            
            result = {
                "success": False,
                "error": str(e),
                "duration_seconds": duration,
                "timestamp": end_time.isoformat() + 'Z'
            }
            
            return False, result
    
    def _check_prerequisites(self, template: Dict[str, Any]) -> bool:
        """Check all prerequisites before execution"""
        prerequisites = template.get('prerequisites', [])
        
        if not prerequisites:
            return True
        
        print(f"\n[INFO] Checking {len(prerequisites)} prerequisites...")
        
        for i, prereq in enumerate(prerequisites, 1):
            check_name = prereq.get('check', f'prerequisite_{i}')
            command = prereq.get('command', '')
            
            print(f"  [{i}/{len(prerequisites)}] {check_name}...", end=' ')
            
            try:
                import subprocess
                result = subprocess.run(
                    command,
                    shell=True,
                    cwd=self.repo_root,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                
                # Check expected output if provided
                expected = prereq.get('expected', '')
                expected_contains = prereq.get('expected_contains', '')
                
                if expected and expected not in result.stdout:
                    print(f"✗ (output doesn't match)")
                    return False
                
                if expected_contains and expected_contains not in result.stdout:
                    print(f"✗ (expected '{expected_contains}' not found)")
                    return False
                
                if result.returncode != 0:
                    print(f"✗ (exit code {result.returncode})")
                    return False
                
                print("✓")
                
            except Exception as e:
                print(f"✗ ({e})")
                return False
        
        return True
    
    def _execute_steps(
        self,
        steps: list,
        variables: Dict[str, Any]
    ) -> bool:
        """Execute all steps in order"""
        for i, step in enumerate(steps, 1):
            step_name = step.get('name', f'step_{i}')
            step_type = step.get('type', 'unknown')
            
            print(f"\n[{i}/{len(steps)}] {step_name} ({step_type})")
            
            # Check if step should continue on failure
            continue_on_failure = step.get('continue_on_failure', False)
            
            success, output = self.step_executor.execute_step(step, variables)
            
            # Log execution
            self.execution_log.append({
                'step': step_name,
                'success': success,
                'output': output
            })
            
            if not success and not continue_on_failure:
                return False
        
        return True
    
    def _execute_rollback(
        self,
        template: Dict[str, Any],
        variables: Dict[str, Any]
    ) -> None:
        """Execute rollback steps"""
        rollback = template.get('rollback', {})
        
        if not rollback.get('enabled', True):
            return
        
        rollback_steps = rollback.get('on_failure', [])
        
        if not rollback_steps:
            return
        
        print(f"\n[INFO] Executing {len(rollback_steps)} rollback steps...")
        
        for i, step in enumerate(rollback_steps, 1):
            step_name = step.get('name', f'rollback_{i}')
            print(f"  [{i}/{len(rollback_steps)}] {step_name}")
            
            try:
                self.step_executor.execute_step(step, variables)
            except Exception as e:
                print(f"  [WARN] Rollback step failed: {e}")
    
    def _send_notifications(
        self,
        template: Dict[str, Any],
        trigger: str,
        variables: Dict[str, Any]
    ) -> None:
        """Send notifications based on trigger"""
        notifications = template.get('notifications', {}).get(trigger, [])
        
        for notification in notifications:
            step = {
                'name': f'notification_{trigger}',
                'type': 'notification',
                **notification
            }
            
            # Substitute variables in message
            if 'message' in step:
                message = step['message']
                for key, value in variables.items():
                    message = message.replace(f"${{{key}}}", str(value))
                step['message'] = message
            
            try:
                self.step_executor.execute_step(step, variables)
            except Exception as e:
                print(f"[WARN] Notification failed: {e}")


def main():
    """CLI entry point"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python orchestrator.py <template> [param1=value1] [param2=value2] ...")
        print("\nExamples:")
        print("  python orchestrator.py deploy/mcp-server app_name=garza-home-mcp")
        print("  python orchestrator.py maintain/health-check service_group=mcp_core")
        sys.exit(1)
    
    template_path = sys.argv[1]
    
    # Parse parameters
    parameters = {}
    for arg in sys.argv[2:]:
        if '=' in arg:
            key, value = arg.split('=', 1)
            parameters[key] = value
    
    # Execute
    orchestrator = Orchestrator()
    success, result = orchestrator.execute(template_path, parameters)
    
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
