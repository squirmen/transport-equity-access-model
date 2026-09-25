from types import SimpleNamespace

from team.export import write_downloads_page


def settings_for(slug: str = "auckland", place: str = "Auckland", agency: str = "Auckland Transport"):
    """Just enough of a Settings object for the downloads page."""
    return SimpleNamespace(naming={"slug": slug, "place": place, "agency": agency})


def test_downloads_page_lists_existing_files(tmp_path):
    (tmp_path / "team_auckland_h3.csv").write_text("h3\n")
    (tmp_path / "fields.csv").write_text("field,description\n")
    write_downloads_page(tmp_path, settings_for())
    page = (tmp_path / "index.html").read_text()
    assert 'href="team_auckland_h3.csv"' in page
    assert 'href="fields.csv"' in page
    assert "team_auckland_h3.gpkg" not in page
    assert "__ROWS__" not in page and "__VERSION__" not in page and "__BUILT__" not in page
    assert "__PLACE__" not in page


def test_downloads_page_names_the_place_it_was_built_for(tmp_path):
    (tmp_path / "team_otautahi_h3.csv").write_text("h3\n")
    write_downloads_page(tmp_path, settings_for(slug="otautahi", place="Christchurch", agency="Environment Canterbury"))
    page = (tmp_path / "index.html").read_text()
    assert 'href="team_otautahi_h3.csv"' in page
    assert "Christchurch" in page
    assert "Environment Canterbury" in page
    # Nothing about the page should still say Auckland, apart from the university.
    assert "Auckland" not in page.replace("University of Auckland", "")
