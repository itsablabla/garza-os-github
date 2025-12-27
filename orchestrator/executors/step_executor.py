"""
Step Executor - Executes individual operation steps
Handles all step types: lock, git, ssh_command, state_check, etc.
"""
import subprocess
import time
import requests
from pathlib import Path
from typing import Any, Dict, Optional


class StepExecutor:
    """Executes operation steps based on type"""
    
    def __init__(
        self,
        repo_root: str,
        lock_manager,
        state_manager
    ):
        self.repo_root = Path(repo_root)
        self.lock_manager = lock_manager
        self.state_manager = state_manager
        self.context = {}  # Stores step outputs
    
    def execute_step(
        self,
        step: Dict[str, Any],
        variables: Dict[str, Any]
    ) -> tuple[bool, Optional[Any]]:
        """
        Execute a step and return (success, output)
        """
        step_type = step['type']
        
        # Dispatch to appropriate handler
        handlers = {
            'lock': self._execute_lock,
            'unlock': self._execute_unlock,
            'git': self._execute_git,
            'ssh_command': self._execute_ssh,
            'state_check': self._execute_state_check,
            'state_update': self._execute_state_update,
            'health_check': self._execute_health_check,
            'conditional': self._execute_conditional,
            'foreach': self._execute_foreach,
            'delay': self._execute_delay,
            'notification': self._execute_notification,
            'operation_log': self._execute_operation_log,
        }
        
        handler = handlers.get(step_type)
        if not handler:
            print(f"[WARN] Unknown step type: {step_type}")
            return True, None
        
        try:
            output = handler(step, variables)
            
            # Store output if requested
            if 'output' in step:
                self.context[step['output']] = output
                variables[step['output']] = output
            
            return True, output
            
        except Exception as e:
            print(f"[ERROR] Step '{step['name']}' failed: {e}")
            return False, None
    
    def _execute_lock(self, step: Dict, vars: Dict) -> bool:
        """Acquire lock on resource"""
        resource = vars.get('resource', step.get('resource', ''))
        metadata = step.get('metadata', {})
        
        operator = metadata.get('operator', 'claude')
        operation = metadata.get('operation', 'unknown')
        
        success = self.lock_manager.acquire_lock(resource, operator, operation)
        
        if not success:
            raise Exception(f"Failed to acquire lock on {resource}")
        
        return success
    
    def _execute_unlock(self, step: Dict, vars: Dict) -> bool:
        """Release lock on resource"""
        resource = vars.get('resource', step.get('resource', ''))
        force = step.get('force', False)
        
        return self.lock_manager.release_lock(resource, force)
    
    def _execute_git(self, step: Dict, vars: Dict) -> str:
        """Execute git command(s)"""
        commands = step.get('commands', [step.get('command')])
        
        outputs = []
        for cmd in commands:
            result = subprocess.run(
                cmd.split(),
                cwd=self.repo_root,
                capture_output=True,
                text=True
            )
            
            if result.returncode != 0:
                raise Exception(f"Git command failed: {cmd}\n{result.stderr}")
            
            outputs.append(result.stdout)
        
        return '\n'.join(outputs)
    
    def _execute_ssh(self, step: Dict, vars: Dict) -> str:
        """Execute SSH command"""
        host = step.get('host', '')
        directory = step.get('directory', '')
        timeout = step.get('timeout', 60)
        
        commands = step.get('commands', [step.get('command')])
        
        # Build SSH command
        ssh_script = self.repo_root / "scripts" / "ssh" / "connect.sh"
        
        outputs = []
        for cmd in commands:
            if directory:
                cmd = f"cd {directory} && {cmd}"
            
            result = subprocess.run(
                [str(ssh_script), host, cmd],
                capture_output=True,
                text=True,
                timeout=timeout
            )
            
            if result.returncode != 0:
                raise Exception(f"SSH command failed: {cmd}\n{result.stderr}")
            
            outputs.append(result.stdout)
        
        return '\n'.join(outputs)
    
    def _execute_state_check(self, step: Dict, vars: Dict) -> Any:
        """Check value in state file"""
        file = step.get('file', '')
        path = step.get('path', '')
        
        return self.state_manager.get_value(file, path)
    
    def _execute_state_update(self, step: Dict, vars: Dict) -> None:
        """Update values in state file"""
        file = step.get('file', '')
        updates = step.get('updates', {})
        
        self.state_manager.update_values(file, updates)
    
    def _execute_health_check(self, step: Dict, vars: Dict) -> str:
        """Execute health check"""
        method = step.get('method', 'http')
        retries = step.get('retries', 1)
        retry_delay = step.get('retry_delay', 5)
        optional = step.get('optional', False)
        
        for attempt in range(retries):
            try:
                if method == 'http':
                    url = step.get('url', '')
                    expected_status = step.get('expected_status', 200)
                    timeout = step.get('timeout', 10)
                    
                    response = requests.get(url, timeout=timeout)
                    
                    if response.status_code == expected_status:
                        return 'ok'
                
                elif method == 'ssh_command':
                    # Use SSH executor
                    result = self._execute_ssh(step, vars)
                    
                    expected_output = step.get('expected_output', '')
                    if expected_output in result:
                        return 'ok'
                
            except Exception as e:
                if attempt < retries - 1:
                    time.sleep(retry_delay)
                elif optional:
                    return 'skipped'
                else:
                    raise Exception(f"Health check failed: {e}")
        
        return 'failed'
    
    def _execute_conditional(self, step: Dict, vars: Dict) -> Any:
        """Execute conditional step"""
        condition = step.get('condition', '')
        
        # Simple condition evaluation
        # For now, just check variable equality
        # Example: "${platform} == 'fly.io'"
        
        # TODO: Implement proper condition parser
        # For now, return True to execute steps
        
        if 'steps' in step:
            # Execute sub-steps
            for substep in step['steps']:
                success, output = self.execute_step(substep, vars)
                if not success:
                    return None
        
        return True
    
    def _execute_foreach(self, step: Dict, vars: Dict) -> list:
        """Execute foreach loop"""
        items = vars.get('items', step.get('items', []))
        item_var = step.get('as', 'item')
        substeps = step.get('steps', [])
        
        results = []
        for item in items:
            # Set loop variable
            loop_vars = {**vars, item_var: item}
            
            # Execute sub-steps
            for substep in substeps:
                success, output = self.execute_step(substep, loop_vars)
                if not success:
                    raise Exception(f"Foreach step failed for item: {item}")
                results.append(output)
        
        return results
    
    def _execute_delay(self, step: Dict, vars: Dict) -> None:
        """Wait for specified seconds"""
        seconds = step.get('seconds', 0)
        description = step.get('description', '')
        
        if description:
            print(f"[INFO] {description}")
        
        time.sleep(seconds)
    
    def _execute_notification(self, step: Dict, vars: Dict) -> None:
        """Send notification (placeholder)"""
        channel = step.get('channel', 'log')
        message = step.get('message', '')
        priority = step.get('priority', 'normal')
        
        # For now, just log
        prefix = "🚨" if priority == 'high' else "ℹ️"
        print(f"[{channel.upper()}] {prefix} {message}")
    
    def _execute_operation_log(self, step: Dict, vars: Dict) -> None:
        """Log operation to operations.json"""
        entry = step.get('entry', {})
        
        self.state_manager.append_operation(entry)
