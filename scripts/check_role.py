from pathlib import Path
text=Path('repo.meta.yaml').read_text()
assert 'role_contract:' in text
assert 'observer_digest_view_surface' in text
print('role-contract: OK leitstand')
