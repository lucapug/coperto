"""Authentication: none.

plan.md §2 and openapi.yaml (`security: []`): the tool runs on a single
trusted device with no login. Every router depends on
`require_trusted_device` so this module stays the one place to change if
authentication ever becomes a requirement.
"""

from fastapi import Depends


async def require_trusted_device() -> None:
    """Allow-all stand-in for a real auth dependency."""
    return None


TRUSTED_DEVICE = Depends(require_trusted_device)
