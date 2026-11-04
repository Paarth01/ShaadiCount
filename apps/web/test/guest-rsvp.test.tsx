import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') } }));
const put = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
  newKey: vi.fn().mockImplementation(() => `key-${Math.random().toString(36).slice(2)}-padding`),
}));
import { GuestRsvp } from '@/components/GuestRsvp';

const view = (over: Record<string, unknown> = {}) => ({
  guestName: 'Anita Rao',
  language: 'en',
  event: { name: 'Aarav & Diya', timezone: 'Asia/Kolkata' },
  function: { name: 'Mehendi', startsAt: '2027-02-10T11:30:00.000Z', venue: 'Garden Lawn' },
  partySizeMax: 4,
  allowChildren: true,
  deadline: '2027-02-05T12:30:00.000Z',
  state: 'open',
  response: null,
  checkinCode: null,
  ...over,
});
const answered = (status: string, a: number, c: number, v = 1, code: string | null = null) =>
  view({ response: { status, adultCount: a, childCount: c, version: v }, checkinCode: code });
const err = (status: number, code: string, extra: Record<string, unknown> = {}) => new ApiError(status, code, `msg ${code}`, [], extra);

describe('<GuestRsvp />', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
  });

  it('shows the function details and starts with nothing pre-selected', async () => {
    get.mockResolvedValue(view());
    render(<GuestRsvp token="t" />);
    expect(await screen.findByRole('heading', { name: 'Mehendi' })).toBeInTheDocument();
    expect(screen.getByText(/Garden Lawn/)).toBeInTheDocument();
    expect(screen.getByText(/10 Feb 2027/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send my RSVP/ })).toBeDisabled();
    expect(get).toHaveBeenCalledWith('/v1/public/rsvp/t');
  });

  it('submits Yes with counts, version 0 and an idempotency key, then shows thanks and the check-in QR', async () => {
    get.mockResolvedValue(view());
    put.mockResolvedValue(answered('yes', 2, 1, 1, 'ABCDEFGHJKLM'));
    render(<GuestRsvp token="tok" />);
    await screen.findByRole('heading', { name: 'Mehendi' });
    fireEvent.click(screen.getByRole('button', { name: /Yes, we will be there/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Adults +' }));
    fireEvent.click(screen.getByRole('button', { name: 'Children +' }));
    fireEvent.click(screen.getByRole('button', { name: /Send my RSVP/ }));
    await screen.findByText(/we are delighted/i);
    expect(put).toHaveBeenCalledWith(
      '/v1/public/rsvp/tok/response',
      { status: 'yes', adultCount: 2, childCount: 1, version: 0 },
      { idempotencyKey: expect.stringMatching(/^key-/) },
    );
    expect(screen.getByText('ABCDEFGHJKLM')).toBeInTheDocument();
    expect(await screen.findByAltText(/ABCDEFGHJKLM/)).toHaveAttribute('src', 'data:image/png;base64,QR');
    expect(screen.getByRole('button', { name: 'Change my answer' })).toBeInTheDocument();
  });

  it('cannot exceed the invited party size and requires at least one person for Yes', async () => {
    get.mockResolvedValue(view({ partySizeMax: 2 }));
    render(<GuestRsvp token="t" />);
    await screen.findByRole('heading', { name: 'Mehendi' });
    fireEvent.click(screen.getByRole('button', { name: /Yes, we will be there/ }));
    const plusA = screen.getByRole('button', { name: 'Adults +' });
    fireEvent.click(plusA);
    expect(plusA).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Children +' })).toBeDisabled(); // 2 of 2 used
    fireEvent.click(screen.getByRole('button', { name: 'Adults −' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adults −' }));
    fireEvent.click(screen.getByRole('button', { name: /Send my RSVP/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add at least one person');
    expect(put).not.toHaveBeenCalled();
  });

  it('hides the children stepper when the function does not count children', async () => {
    get.mockResolvedValue(view({ allowChildren: false }));
    render(<GuestRsvp token="t" />);
    await screen.findByRole('heading', { name: 'Mehendi' });
    fireEvent.click(screen.getByRole('button', { name: /Yes, we will be there/ }));
    expect(screen.queryByRole('button', { name: 'Children +' })).toBeNull();
    expect(screen.getByText(/Children are not included/)).toBeInTheDocument();
  });

  it('reuses the SAME idempotency key when retrying an unchanged answer after a network failure, but a new key when the answer changes', async () => {
    get.mockResolvedValue(view());
    put
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'offline'))
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'offline'))
      .mockResolvedValue(answered('no', 0, 0));
    render(<GuestRsvp token="t" />);
    await screen.findByRole('heading', { name: 'Mehendi' });
    fireEvent.click(screen.getByRole('button', { name: /can't make it/ }));
    fireEvent.click(screen.getByRole('button', { name: /Send my RSVP/ }));
    await screen.findByText(/No connection/);
    fireEvent.click(screen.getByRole('button', { name: /Send my RSVP/ }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1][2].idempotencyKey).toBe(put.mock.calls[0][2].idempotencyKey);
    fireEvent.click(screen.getByRole('button', { name: /Maybe/ }));
    fireEvent.click(screen.getByRole('button', { name: /Send my RSVP/ }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(3));
    expect(put.mock.calls[2][2].idempotencyKey).not.toBe(put.mock.calls[0][2].idempotencyKey);
  });

  it('on a version conflict, loads the latest answer and explains what happened', async () => {
    get.mockResolvedValue(answered('yes', 1, 0, 1));
    put.mockRejectedValue(err(409, 'VERSION_CONFLICT', { current: { status: 'no', adultCount: 0, childCount: 0, version: 2 } }));
    render(<GuestRsvp token="t" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change my answer' }));
    fireEvent.click(screen.getByRole('button', { name: /Maybe/ }));
    fireEvent.click(screen.getByRole('button', { name: /Update my RSVP/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed on another device/);
    expect(screen.getByRole('button', { name: /can't make it/ })).toHaveAttribute('aria-pressed', 'true');
    expect(put.mock.calls[0][1]).toMatchObject({ version: 1 });
  });

  it('switches to Hindi without losing the selected answer or counts', async () => {
    get.mockResolvedValue(view());
    render(<GuestRsvp token="t" />);
    await screen.findByRole('heading', { name: 'Mehendi' });
    fireEvent.click(screen.getByRole('button', { name: /Yes, we will be there/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Adults +' }));
    fireEvent.click(screen.getByRole('button', { name: 'हिन्दी' }));
    expect(screen.getByRole('button', { name: /हाँ, हम आएँगे/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('कुल')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /मेरा उत्तर भेजें/ })).toBeEnabled();
    expect(within(screen.getByRole('main')).getByRole('heading', { name: /क्या आप हमारे साथ शामिल होंगे/ })).toBeInTheDocument();
  });

  it("opens in the guest's preferred language", async () => {
    get.mockResolvedValue(view({ language: 'hi' }));
    render(<GuestRsvp token="t" />);
    expect(await screen.findByText(/नमस्ते Anita Rao/)).toBeInTheDocument();
  });

  it.each([
    ['closed_deadline', /deadline has passed/i],
    ['closed_cancelled', /RSVPs are closed/i],
    ['locked', /Please contact the host to change/i],
  ])('shows a read-only %s state with no form', async (state, text) => {
    get.mockResolvedValue(view({ state }));
    render(<GuestRsvp token="t" />);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send my RSVP/ })).toBeNull();
  });

  it('does not offer edits once the deadline passes, even with an existing answer', async () => {
    get.mockResolvedValue({ ...answered('yes', 2, 0, 1, 'ABCDEFGHJKLM'), state: 'closed_deadline' });
    render(<GuestRsvp token="t" />);
    expect(await screen.findByText(/deadline has passed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change my answer' })).toBeNull();
    expect(screen.getByText('ABCDEFGHJKLM')).toBeInTheDocument();
  });

  it.each([
    [404, 'This link is not valid', /check the link/i],
    [410, 'This link is not valid', /no longer active/i],
  ])('shows a safe message for a %s link', async (status, title, body) => {
    get.mockRejectedValue(err(status as number, 'X'));
    render(<GuestRsvp token="bad" />);
    expect(await screen.findByRole('heading', { name: title as string })).toBeInTheDocument();
    expect(screen.getByText(body as RegExp)).toBeInTheDocument();
  });

  it('offers a retry when the network fails while loading', async () => {
    get.mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'x')).mockResolvedValueOnce(view());
    render(<GuestRsvp token="t" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Mehendi' })).toBeInTheDocument();
  });

  it('never renders contact details or the token', async () => {
    get.mockResolvedValue(view());
    const { container } = render(<GuestRsvp token="SECRET-TOKEN-VALUE" />);
    await screen.findByRole('heading', { name: 'Mehendi' });
    expect(container.innerHTML).not.toContain('SECRET-TOKEN-VALUE');
  });
});
