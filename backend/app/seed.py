"""Demo data so the frontend has something to show on first load."""

from datetime import timedelta

from .models import AddPartyInput
from .store import InMemoryStore


def seed_demo_data(store: InMemoryStore) -> None:
    store.open_shift()

    store.add_party(
        AddPartyInput(name="Rossi", size=4, phone="333 1234567", estimated_wait_minutes=25)
    )
    store.add_party(
        AddPartyInput(name="Bianchi", size=2, phone="333 7654321", estimated_wait_minutes=10)
    )
    store.add_party(AddPartyInput(name="Verdi", size=6, phone="333 5550000"))
    greco = store.add_party(AddPartyInput(name="Greco", size=3, phone="333 1112223"))
    esposito = store.add_party(AddPartyInput(name="Esposito", size=8, phone="333 9998887"))

    labels = {table.label: table.id for table in store.list_tables()}
    store.seat_party(greco.id, [labels["T1"]])
    # 3 x 4-seaters: 12 gross, 2 junctions, 8 usable — fits exactly
    store.seat_party(esposito.id, [labels["T5"], labels["T6"], labels["T7"]])
    # a free-standing 6-seat group (8 gross, 1 junction)
    store.combine_tables([labels["T9"], labels["T10"]])

    # a no-show for the waitlist's no-show section: seat then expire via sweep
    conti = store.add_party(AddPartyInput(name="Conti", size=2, phone="333 2223334"))
    store.seat_party(conti.id, [labels["T2"]])
    store.parties[conti.id].booked_until = store.now() - timedelta(minutes=5)
    store.sweep()
