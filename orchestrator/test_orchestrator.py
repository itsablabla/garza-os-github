#!/usr/bin/env python3
"""
Test script for orchestrator components
Validates that all core functionality works
"""
import sys
from pathlib import Path

# Add orchestrator to path
sys.path.insert(0, str(Path(__file__).parent))

from core.template_parser import TemplateParser
from managers.state_manager import StateManager
from managers.lock_manager import LockManager


def test_template_parser():
    """Test template loading and validation"""
    print("\n=== Testing Template Parser ===")
    
    parser = TemplateParser("/Users/customer/garza-os-github")
    
    # Load template
    print("Loading deploy/mcp-server template...")
    template = parser.load_template("deploy/mcp-server")
    
    print(f"✓ Template loaded: {template['operation']['name']}")
    print(f"  Type: {template['operation']['type']}")
    print(f"  Steps: {len(template['steps'])}")
    
    # Get required parameters
    required = parser.get_required_parameters(template)
    print(f"  Required params: {', '.join(required)}")
    
    # Test variable substitution
    params = {
        'app_name': 'test-app',
        'source_dir': '/test/dir',
        'region': 'dfw'
    }
    
    merged = parser.merge_parameters(template, params)
    print(f"✓ Parameters merged")
    
    final = parser.substitute_variables(template, merged)
    print(f"✓ Variables substituted")
    
    return True


def test_state_manager():
    """Test state file operations"""
    print("\n=== Testing State Manager ===")
    
    state = StateManager("/Users/customer/garza-os-github")
    
    # Read deployments
    print("Reading deployments.json...")
    deployments = state.read_state("deployments.json")
    
    if 'fly_apps' in deployments:
        app_count = len(deployments['fly_apps'])
        print(f"✓ Found {app_count} Fly apps")
    
    # Test get value
    if deployments.get('fly_apps'):
        first_app = list(deployments['fly_apps'].keys())[0]
        status = state.get_value("deployments.json", f".fly_apps.{first_app}.status")
        print(f"✓ Got status for {first_app}: {status}")
    
    print("✓ State manager working")
    
    return True


def test_lock_manager():
    """Test lock acquisition/release"""
    print("\n=== Testing Lock Manager ===")
    
    locks = LockManager("/Users/customer/garza-os-github")
    
    test_resource = "test-orchestrator-validation"
    
    # Check if already locked
    if locks.is_locked(test_resource):
        print(f"⚠️  {test_resource} already locked, releasing...")
        locks.release_lock(test_resource, force=True)
    
    # Acquire lock
    print(f"Acquiring lock on {test_resource}...")
    success = locks.acquire_lock(test_resource, "test", "validation")
    
    if success:
        print("✓ Lock acquired")
    else:
        print("✗ Failed to acquire lock")
        return False
    
    # Check lock status
    if locks.is_locked(test_resource):
        info = locks.get_lock_info(test_resource)
        print(f"✓ Lock confirmed")
        print(f"  Operator: {info.get('operator')}")
        print(f"  Operation: {info.get('operation')}")
    
    # Release lock
    print(f"Releasing lock on {test_resource}...")
    locks.release_lock(test_resource)
    
    if not locks.is_locked(test_resource):
        print("✓ Lock released")
    else:
        print("✗ Lock still present")
        return False
    
    print("✓ Lock manager working")
    
    return True


def test_dry_run():
    """Test dry run execution"""
    print("\n=== Testing Dry Run ===")
    
    from orchestrator import Orchestrator
    
    orch = Orchestrator()
    
    print("Running dry run of deploy/mcp-server...")
    success, result = orch.execute(
        'deploy/mcp-server',
        parameters={
            'app_name': 'test-app',
            'source_dir': '/test/dir'
        },
        dry_run=True
    )
    
    if success and result.get('dry_run'):
        print("✓ Dry run completed successfully")
        return True
    else:
        print("✗ Dry run failed")
        return False


def main():
    """Run all tests"""
    print("GARZA OS Orchestrator - Component Tests")
    print("=" * 50)
    
    tests = [
        ("Template Parser", test_template_parser),
        ("State Manager", test_state_manager),
        ("Lock Manager", test_lock_manager),
        ("Dry Run", test_dry_run),
    ]
    
    results = []
    
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"\n✗ {test_name} failed with exception:")
            print(f"  {e}")
            results.append((test_name, False))
    
    # Summary
    print("\n" + "=" * 50)
    print("TEST SUMMARY")
    print("=" * 50)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status} - {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1


if __name__ == '__main__':
    sys.exit(main())
