"""The downloads page lists the files that exist and nothing else."""

from team.export import write_downloads_page


def test_downloads_page_lists_existing_files(tmp_path):
    (tmp_path / "team_auckland_h3.csv").write_text("h3\n")
    (tmp_path / "fields.csv").write_text("field,description\n")
    write_downloads_page(tmp_path)
    page = (tmp_path / "index.html").read_text()
    assert 'href="team_auckland_h3.csv"' in page
    assert 'href="fields.csv"' in page
    assert "team_auckland_h3.gpkg" not in page
    assert "__ROWS__" not in page and "__VERSION__" not in page and "__BUILT__" not in page
