from app.domain.food_resolution import _escape_like


def test_ilike_wildcards_are_matched_literally():
    assert _escape_like("paneer") == "paneer"
    assert _escape_like("50% off") == "50\\% off"
    assert _escape_like("a_b") == "a\\_b"
    assert _escape_like("back\\slash") == "back\\\\slash"
    # PostgREST treats * as a wildcard, so a literal asterisk becomes a
    # single-character wildcard rather than "match anything".
    assert _escape_like("a*b") == "a_b"
