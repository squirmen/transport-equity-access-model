import numpy as np

from team.chains import best_rounds, orders, stop_sets

INF = np.float32(np.inf)


def test_the_pharmacy_follows_the_gp():
    got = orders(("gp", "pharmacy", "supermarket"), {"pharmacy": "gp"})
    assert ("pharmacy", "gp", "supermarket") not in got
    assert ("supermarket", "gp", "pharmacy") in got
    assert len(got) == 3


def test_every_set_of_two_or_more():
    assert stop_sets(["gp", "pharmacy", "supermarket"]) == [
        ("gp", "pharmacy", "supermarket"), ("gp", "pharmacy"), ("gp", "supermarket"), ("pharmacy", "supermarket")]


def test_a_gp_with_a_pharmacy_next_door_beats_the_nearest_gp():
    # Stops: 0 a GP 5 min away, 1 a GP 8 min away, 2 a pharmacy next to GP 1
    # (1 min), 20 min from GP 0; the pharmacy is 9 min from home.
    links = np.full((3, 3), INF, dtype="float32")
    np.fill_diagonal(links, 0)
    links[0, 2] = 20
    links[1, 2] = 1
    home = {
        "gp": (np.array([[5, 8]], dtype="float32"), np.array([[0, 1]], dtype="int32")),
        "pharmacy": (np.array([[9, INF]], dtype="float32"), np.array([[2, 0]], dtype="int32")),
    }
    best = best_rounds(home, links, [("gp", "pharmacy")], [10.0, float("inf")])
    # Nearest GP then pharmacy: 5 + 20 + 9 = 34. Via GP 1: 8 + 1 + 9 = 18.
    assert best[0, 1] == 18
    # With no leg over 10 minutes the same round still works: 8, 1, 9.
    assert best[0, 0] == 18


def test_an_empty_slot_is_never_a_stop():
    # Only one supermarket in reach; the empty second slot points at stop 0,
    # which is right beside the GP, and must not be used.
    links = np.full((3, 3), INF, dtype="float32")
    np.fill_diagonal(links, 0)
    links[1, 0] = 1
    links[1, 2] = 30
    home = {
        "gp": (np.array([[5, INF]], dtype="float32"), np.array([[1, 0]], dtype="int32")),
        "supermarket": (np.array([[10, INF]], dtype="float32"), np.array([[2, 0]], dtype="int32")),
    }
    best = best_rounds(home, links, [("gp", "supermarket")], [float("inf")])
    assert best[0, 0] == 5 + 30 + 10


def test_a_leg_limit_rules_out_a_long_walk():
    links = np.zeros((2, 2), dtype="float32")
    links[0, 1] = links[1, 0] = 12
    home = {
        "gp": (np.array([[4]], dtype="float32"), np.array([[0]], dtype="int32")),
        "supermarket": (np.array([[6]], dtype="float32"), np.array([[1]], dtype="int32")),
    }
    best = best_rounds(home, links, [("gp", "supermarket")], [10.0, 15.0])
    assert np.isinf(best[0, 0])
    assert best[0, 1] == 22


def test_the_way_home_can_be_longer_than_the_way_out():
    # Downhill to the shop in 6 minutes, 9 back up.
    links = np.zeros((2, 2), dtype="float32")
    links[0, 1] = links[1, 0] = 3
    home = {
        "gp": (np.array([[4]], dtype="float32"), np.array([[0]], dtype="int32")),
        "supermarket": (np.array([[6]], dtype="float32"), np.array([[1]], dtype="int32")),
    }
    back = {"gp": np.array([[5]], dtype="float32"), "supermarket": np.array([[9]], dtype="float32")}
    best = best_rounds(home, links, [("gp", "supermarket")], [8.0, float("inf")], back=back)
    assert best[0, 1] == 4 + 3 + 9
    # The climb home is the longest stretch, so an 8-minute limit rules it out.
    assert np.isinf(best[0, 0])
