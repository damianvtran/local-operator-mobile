"""Proves what the server accepts as a tag name, on the real code path the phone uses.
Path: mobile editor -> POST /api/library/tags -> local_operator/mobile/library.py create_tag_payload
      -> MetadataStore.create_tag -> _normalise_tag_name (^[a-z0-9][a-z0-9_-]{0,23}$)."""
import tempfile
from local_operator.library.metadata import _normalise_tag_name, MetadataStore, TagRefused

print("== function-level probe: _normalise_tag_name (the gate create_tag applies)")
for loc, t in [("en", "topic-name"), ("es", "nombre-del-tema"), ("hi", "विषय-नाम"),
               ("ur", "موضوع-تگ"), ("ur-audited", "موضوع-اِسٹر"), ]:
    pass  # placeholder branch kept out of output; explicit list below

cases = [
    ("en", "topic-name"),
    ("es", "nombre-del-tema"),
    ("ru", "тема-файла"),
    ("vi", "ten-chu-de"),
    ("hi", "विषय-नाम"),
    ("ur", "موضوع-کا-نام"),
]
for loc, t in cases:
    try:
        print(f"{loc:6} {t!r:20} -> accepted as {_normalise_tag_name(t)!r}")
    except TagRefused as e:
        print(f"{loc:6} {t!r:20} -> REFUSED by the tag grammar {e.args}")

print()
print("== real-store probe: MetadataStore.create_tag in a throwaway config dir (same call the route makes)")
store = MetadataStore(tempfile.mkdtemp())
for loc, t in [("ur", "موضوع-کا-نام"), ("hi", "विषय-नाम"), ("en", "topic-name")]:
    try:
        row = store.create_tag(t)
        print(f"{loc:6} {t!r:20} -> CREATED id={row['id']} name={row['name']!r}")
    except TagRefused as e:
        print(f"{loc:6} {t!r:20} -> TagRefused{e.args} (route maps 422 {e.args[0] if e.args else ''})")
