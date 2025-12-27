"""
Operation Queue - Manages concurrent operation execution
Prevents conflicts, tracks status, and handles failures
"""
import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from enum import Enum


class OperationStatus(Enum):
    """Operation execution status"""
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class QueuedOperation:
    """Represents a queued operation"""
    
    def __init__(
        self,
        operation_id: str,
        template_path: str,
        parameters: Dict[str, Any],
        priority: int = 5
    ):
        self.id = operation_id
        self.template_path = template_path
        self.parameters = parameters
        self.priority = priority
        self.status = OperationStatus.QUEUED
        self.created_at = datetime.utcnow()
        self.started_at = None
        self.completed_at = None
        self.error = None
        self.result = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            'id': self.id,
            'template_path': self.template_path,
            'parameters': self.parameters,
            'priority': self.priority,
            'status': self.status.value,
            'created_at': self.created_at.isoformat() + 'Z',
            'started_at': self.started_at.isoformat() + 'Z' if self.started_at else None,
            'completed_at': self.completed_at.isoformat() + 'Z' if self.completed_at else None,
            'error': self.error,
            'result': self.result
        }


class OperationQueue:
    """Thread-safe operation queue with priority scheduling"""
    
    def __init__(self, repo_root: str, max_concurrent: int = 3):
        self.repo_root = Path(repo_root)
        self.max_concurrent = max_concurrent
        
        self.queue: List[QueuedOperation] = []
        self.running: Dict[str, QueuedOperation] = {}
        self.completed: List[QueuedOperation] = []
        
        self.lock = threading.Lock()
        self.worker_threads: List[threading.Thread] = []
        self.running_flag = False
    
    def add_operation(
        self,
        template_path: str,
        parameters: Dict[str, Any],
        priority: int = 5
    ) -> str:
        """
        Add operation to queue
        Returns operation ID
        """
        with self.lock:
            # Generate operation ID
            operation_id = f"op_{int(time.time())}_{len(self.queue)}"
            
            # Create operation
            operation = QueuedOperation(
                operation_id,
                template_path,
                parameters,
                priority
            )
            
            # Add to queue
            self.queue.append(operation)
            
            # Sort by priority (higher priority first)
            self.queue.sort(key=lambda op: op.priority, reverse=True)
            
            print(f"[QUEUE] Added operation {operation_id}: {template_path}")
            
            return operation_id
    
    def get_operation_status(self, operation_id: str) -> Optional[Dict[str, Any]]:
        """Get status of an operation"""
        with self.lock:
            # Check running
            if operation_id in self.running:
                return self.running[operation_id].to_dict()
            
            # Check queue
            for op in self.queue:
                if op.id == operation_id:
                    return op.to_dict()
            
            # Check completed
            for op in self.completed:
                if op.id == operation_id:
                    return op.to_dict()
        
        return None
    
    def cancel_operation(self, operation_id: str) -> bool:
        """Cancel a queued operation (cannot cancel running operations)"""
        with self.lock:
            for i, op in enumerate(self.queue):
                if op.id == operation_id:
                    op.status = OperationStatus.CANCELLED
                    op.completed_at = datetime.utcnow()
                    self.completed.append(op)
                    self.queue.pop(i)
                    print(f"[QUEUE] Cancelled operation {operation_id}")
                    return True
        
        return False
    
    def list_operations(
        self,
        status_filter: Optional[OperationStatus] = None
    ) -> List[Dict[str, Any]]:
        """List all operations, optionally filtered by status"""
        with self.lock:
            all_ops = []
            
            # Add queued
            for op in self.queue:
                if status_filter is None or op.status == status_filter:
                    all_ops.append(op.to_dict())
            
            # Add running
            for op in self.running.values():
                if status_filter is None or op.status == status_filter:
                    all_ops.append(op.to_dict())
            
            # Add completed (last 100)
            for op in self.completed[-100:]:
                if status_filter is None or op.status == status_filter:
                    all_ops.append(op.to_dict())
            
            return all_ops
    
    def start_workers(self, num_workers: Optional[int] = None):
        """Start worker threads to process queue"""
        if num_workers is None:
            num_workers = self.max_concurrent
        
        self.running_flag = True
        
        for i in range(num_workers):
            worker = threading.Thread(
                target=self._worker_loop,
                name=f"worker-{i}",
                daemon=True
            )
            worker.start()
            self.worker_threads.append(worker)
        
        print(f"[QUEUE] Started {num_workers} worker threads")
    
    def stop_workers(self):
        """Stop all worker threads"""
        self.running_flag = False
        
        for worker in self.worker_threads:
            worker.join(timeout=5)
        
        self.worker_threads.clear()
        print("[QUEUE] Stopped all workers")
    
    def _worker_loop(self):
        """Worker thread main loop"""
        from orchestrator import Orchestrator
        
        orchestrator = Orchestrator(str(self.repo_root))
        
        while self.running_flag:
            operation = self._get_next_operation()
            
            if operation is None:
                time.sleep(1)
                continue
            
            # Execute operation
            try:
                operation.status = OperationStatus.RUNNING
                operation.started_at = datetime.utcnow()
                
                print(f"\n[WORKER] Executing {operation.id}: {operation.template_path}")
                
                success, result = orchestrator.execute(
                    operation.template_path,
                    operation.parameters
                )
                
                operation.status = OperationStatus.SUCCESS if success else OperationStatus.FAILED
                operation.result = result
                
                if not success:
                    operation.error = result.get('error', 'Unknown error')
                
            except Exception as e:
                operation.status = OperationStatus.FAILED
                operation.error = str(e)
                print(f"[WORKER] Operation {operation.id} failed: {e}")
            
            finally:
                operation.completed_at = datetime.utcnow()
                
                # Move to completed
                with self.lock:
                    if operation.id in self.running:
                        del self.running[operation.id]
                    self.completed.append(operation)
                    
                    # Keep only last 1000 completed
                    if len(self.completed) > 1000:
                        self.completed = self.completed[-1000:]
    
    def _get_next_operation(self) -> Optional[QueuedOperation]:
        """Get next operation from queue (thread-safe)"""
        with self.lock:
            # Check if we can run more operations
            if len(self.running) >= self.max_concurrent:
                return None
            
            # Get highest priority operation
            if not self.queue:
                return None
            
            operation = self.queue.pop(0)
            self.running[operation.id] = operation
            
            return operation
    
    def get_stats(self) -> Dict[str, Any]:
        """Get queue statistics"""
        with self.lock:
            queued_count = len(self.queue)
            running_count = len(self.running)
            
            # Count completed by status
            success_count = sum(1 for op in self.completed if op.status == OperationStatus.SUCCESS)
            failed_count = sum(1 for op in self.completed if op.status == OperationStatus.FAILED)
            
            return {
                'queued': queued_count,
                'running': running_count,
                'completed_success': success_count,
                'completed_failed': failed_count,
                'total_completed': len(self.completed),
                'max_concurrent': self.max_concurrent,
                'workers_running': len([t for t in self.worker_threads if t.is_alive()])
            }


def main():
    """CLI for queue management"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python queue_manager.py <command> [args...]")
        print("\nCommands:")
        print("  add <template> [param=value ...]  - Add operation to queue")
        print("  status <operation_id>              - Get operation status")
        print("  cancel <operation_id>              - Cancel queued operation")
        print("  list [queued|running|success|failed] - List operations")
        print("  stats                              - Show queue statistics")
        print("  process [num_workers]              - Process queue (blocking)")
        sys.exit(1)
    
    queue = OperationQueue("/Users/customer/garza-os-github")
    
    command = sys.argv[1]
    
    if command == 'add':
        if len(sys.argv) < 3:
            print("Error: template path required")
            sys.exit(1)
        
        template = sys.argv[2]
        parameters = {}
        
        for arg in sys.argv[3:]:
            if '=' in arg:
                key, value = arg.split('=', 1)
                parameters[key] = value
        
        op_id = queue.add_operation(template, parameters)
        print(f"Operation queued: {op_id}")
    
    elif command == 'status':
        if len(sys.argv) < 3:
            print("Error: operation_id required")
            sys.exit(1)
        
        op_id = sys.argv[2]
        status = queue.get_operation_status(op_id)
        
        if status:
            print(json.dumps(status, indent=2))
        else:
            print(f"Operation not found: {op_id}")
    
    elif command == 'cancel':
        if len(sys.argv) < 3:
            print("Error: operation_id required")
            sys.exit(1)
        
        op_id = sys.argv[2]
        if queue.cancel_operation(op_id):
            print(f"Operation cancelled: {op_id}")
        else:
            print(f"Operation not found or already running: {op_id}")
    
    elif command == 'list':
        status_filter = None
        if len(sys.argv) > 2:
            filter_str = sys.argv[2]
            if filter_str == 'queued':
                status_filter = OperationStatus.QUEUED
            elif filter_str == 'running':
                status_filter = OperationStatus.RUNNING
            elif filter_str == 'success':
                status_filter = OperationStatus.SUCCESS
            elif filter_str == 'failed':
                status_filter = OperationStatus.FAILED
        
        operations = queue.list_operations(status_filter)
        print(json.dumps(operations, indent=2))
    
    elif command == 'stats':
        stats = queue.get_stats()
        print(json.dumps(stats, indent=2))
    
    elif command == 'process':
        num_workers = int(sys.argv[2]) if len(sys.argv) > 2 else None
        queue.start_workers(num_workers)
        
        print("[QUEUE] Processing... (Ctrl+C to stop)")
        
        try:
            while True:
                time.sleep(5)
                stats = queue.get_stats()
                print(f"[STATS] Queued: {stats['queued']}, Running: {stats['running']}, Completed: {stats['completed_success']}/{stats['completed_failed']}")
        except KeyboardInterrupt:
            print("\n[QUEUE] Stopping...")
            queue.stop_workers()
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == '__main__':
    main()
