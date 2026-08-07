"""Small TTL cache shared by the API handlers."""

import time

_cache = {}   # key -> (expires_at, payload)
def cache_get_or(key, ttl, fn, force=False):
    if not force:
        hit = _cache.get(key)
        if hit and hit[0] > time.time():
            return hit[1]
    value = fn()
    _cache[key] = (time.time() + ttl, value)
    return value

