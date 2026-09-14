import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { MockApi } from '../src/services/mock/mockApi';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function openShift() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Open shift' })[0]);
  await screen.findByRole('region', { name: 'Waitlist' });
}

async function addParty(name: string, size: string) {
  fireEvent.click(screen.getByRole('button', { name: '+ Add party' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Party size'), { target: { value: size } });
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '333 1234567' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add party' }));
  await screen.findByText(new RegExp(`#\\d+ ${name} ·`));
}

describe('App', () => {
  it('opens the shift and shows the two panels side by side', async () => {
    render(<App service={new MockApi()} />);
    expect(screen.getByText(/no shift yet/i)).toBeInTheDocument();

    await openShift();

    expect(screen.getByRole('region', { name: 'Tables' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'T1 4 seats, free' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'T30 2 seats, free' })).toBeInTheDocument();
    expect(screen.getByText(/nobody waiting/i)).toBeInTheDocument();
  });

  it('adds a party to the queue', async () => {
    render(<App service={new MockApi()} />);
    await openShift();

    await addParty('Rossi', '4');

    expect(screen.getByText(/#1 Rossi · 4p/)).toBeInTheDocument();
  });

  it('seats a party on a single table from the UI', async () => {
    render(<App service={new MockApi()} />);
    await openShift();
    await addParty('Rossi', '4');

    fireEvent.click(screen.getByRole('button', { name: 'Seat Rossi' }));
    fireEvent.click(screen.getByRole('button', { name: 'T1 4 seats, free' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seat Rossi here' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'T1 4 seats, reserved' })).toBeInTheDocument(),
    );
    expect(screen.getByText(/Rossi · 4p · T1/)).toBeInTheDocument();
    expect(screen.getByText(/min left/)).toBeInTheDocument();
    expect(screen.queryByText(/#1 Rossi · 4p/)).not.toBeInTheDocument();
  });

  it('hard-blocks seating a party larger than the usable seats', async () => {
    render(<App service={new MockApi()} />);
    await openShift();
    await addParty('Bianchi', '7');

    fireEvent.click(screen.getByRole('button', { name: 'Seat Bianchi' }));
    fireEvent.click(screen.getByRole('button', { name: 'T2 4 seats, free' }));

    // 7 people vs 4 usable seats: blocked, with a visible reason
    expect(screen.getByRole('button', { name: 'Seat Bianchi here' })).toBeDisabled();
    expect(screen.getByText(/won’t fit/i)).toBeInTheDocument();

    // adding a second 4-seater: 8 gross, 6 usable — still blocked
    fireEvent.click(screen.getByRole('button', { name: 'T3 4 seats, free' }));
    expect(screen.getByRole('button', { name: 'Seat Bianchi here' })).toBeDisabled();

    // third table: 12 gross, 8 usable — fits
    fireEvent.click(screen.getByRole('button', { name: 'T4 4 seats, free' }));
    expect(screen.getByRole('button', { name: 'Seat Bianchi here' })).toBeEnabled();
  });

  it('combines selected tables into a group with live usable-seat preview', async () => {
    render(<App service={new MockApi()} />);
    await openShift();

    fireEvent.click(screen.getByRole('button', { name: 'T1 4 seats, free' }));
    fireEvent.click(screen.getByRole('button', { name: 'T2 4 seats, free' }));
    expect(screen.getByText(/Selected T1\+T2 · 8 gross · 6 usable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Combine selected' }));

    await screen.findByText(/G1 · 6 usable seats/);
    expect(screen.getByText(/T1\+T2 · gross 8/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'T1 4 seats, combined' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Split group G1' })).toBeInTheDocument();
  });

  it('auto-expires a seated party and releases the table', async () => {
    vi.useFakeTimers();
    let now = Date.parse('2026-07-15T12:00:00Z');
    const api = new MockApi({ graceMs: 50, now: () => now });
    render(<App service={api} />);
    await act(async () => {}); // flush initial load

    fireEvent.click(screen.getAllByRole('button', { name: 'Open shift' })[0]);
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: '+ Add party' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Greco' } });
    fireEvent.change(screen.getByLabelText('Party size'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '333' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add party' }));
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Seat Greco' }));
    fireEvent.click(screen.getByRole('button', { name: 'T1 4 seats, free' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seat Greco here' }));
    await act(async () => {});
    expect(screen.getByText(/Greco · 3p · T1/)).toBeInTheDocument();

    // past the grace window, the 5 s sweep interval fires and expires Greco
    await act(async () => {
      now += 6_000;
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(screen.getByText(/Greco · 3p · expired/)).toBeInTheDocument();
    expect(screen.queryByText(/Greco · 3p · T1/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'T1 4 seats, free' })).toBeInTheDocument();
  });
});
