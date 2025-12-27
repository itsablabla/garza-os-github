"""
Lock Manager - Git-based distributed locking
Prevents concurrent operations on same resource
"""
import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional


class LockManager:
    """Manages resource locks using Git for distributed coordination"""
    
    def __init__(self, repo_root: str):
        self.repo_root = Path(repo_root)
        self.lock_dir = self.repo_root / "infra" / "state" / "locks"
        self.lock_dir.mkdir(parents=True, exist_ok=True)
    
    def _git_command(self, *args) -> tuple[int, str, str]:
        """Execute git command and return (returncode, stdout, stderr)"""
        result = subprocess.run(
            ['git', '-C', str(self.repo_root)] + list(args),
            capture_output=True,
            text=True
        )
        return result.returncode, result.stdout, result.stderr
    
    def is_locked(self, resource: str) -> bool:
        """Check if resource is locked"""
        lock_file = self.lock_dir / f"{resource}.lock"
        return lock_file.exists()
    
    def get_lock_info(self, resource: str) -> Optional[dict]:
        """Get lock metadata if locked"""
        lock_file = self.lock_dir / f"{resource}.lock"
        if not lock_file.exists():
            return None
        
        with open(lock_file, 'r') as f:
            content = f.read()
        
        # Parse simple key-value format
        info = {}
        for line in content.strip().split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                info[key.strip()] = value.strip()
        
        return info
    
    def acquire_lock(
        self, 
        resource: str, 
        operator: str = "claude",
        operation: str = "unknown",
        force: bool = False
    ) -> bool:
        """
        Acquire lock on resource
        Returns True if successful, False if already locked
        """
        # Pull latest locks
        self._git_command('pull', 'origin', 'main')
        
        # Check if already locked
        if self.is_locked(resource) and not force:
            return False
        
        # Create lock file
        lock_file = self.lock_dir / f"{resource}.lock"
        lock_content = f"""operator: {operator}
timestamp: {datetime.utcnow().isoformat()}Z
operation: {operation}
"""
        
        with open(lock_file, 'w') as f:
            f.write(lock_content)
        
        # Commit and push
        self._git_command('add', str(lock_file))
        self._git_command(
            'commit', 
            '-m', 
            f'Lock: {resource} ({operation})'
        )
        
        # Try to push (may fail if someone else pushed)
        returncode, _, _ = self._git_command('push', 'origin', 'main')
        
        if returncode != 0:
            # Someone else got the lock first
            # Roll back our commit
            self._git_command('reset', '--hard', 'HEAD~1')
            self._git_command('pull', 'origin', 'main')
            return False
        
        return True
    
    def release_lock(self, resource: str, force: bool = False) -> bool:
        """
        Release lock on resource
        Returns True if successful
        """
        lock_file = self.lock_dir / f"{resource}.lock"
        
        if not lock_file.exists():
            return True  # Already unlocked
        
        # Pull latest
        self._git_command('pull', 'origin', 'main')
        
        # Remove lock file
        lock_file.unlink()
        
        # Commit and push
        self._git_command('add', str(lock_file))
        self._git_command(
            'commit',
            '-m',
            f'Release lock: {resource}'
        )
        
        returncode, _, _ = self._git_command('push', 'origin', 'main')
        
        if returncode != 0 and not force:
            # Push failed, roll back
            self._git_command('reset', '--hard', 'HEAD~1')
            self._git_command('pull', 'origin', 'main')
            return False
        
        return True
    
    def wait_for_lock(
        self,
        resource: str,
        operator: str = "claude",
        operation: str = "unknown",
        timeout: int = 300,
        check_interval: int = 5
    ) -> bool:
        """
        Wait for lock to become available, then acquire
        Returns True if acquired, False if timeout
        """
        import time
        
        start_time = time.time()
        
        while (time.time() - start_time) < timeout:
            if self.acquire_lock(resource, operator, operation):
                return True
            
            time.sleep(check_interval)
        
        return False
