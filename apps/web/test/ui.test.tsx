import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { Confirm, ErrorBanner, Field, Modal, TextField, ToastProvider } from '@/components/ui';
import { ResponseBar } from '@/components/StatusBadges';
import { roleCan } from '@/lib/auth';

describe('UI primitives', () => {
  it('Field links the label, input and error message for assistive tech', () => {
    render(<TextField label="Mobile number" value="" onChange={() => undefined} error="Enter a valid mobile number" />);
    const input = screen.getByLabelText('Mobile number');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });
  it('Field supports any control via render-prop', () => {
    render(<Field label="Notes">{(id) => <textarea id={id} />}</Field>);
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
  });
  it('Modal is a labelled dialog, closes on Escape and on backdrop click', () => {
    const close = vi.fn();
    const { container } = render(
      <Modal title="Add guest" onClose={close}>
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Add guest' })).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(container.querySelector('.overlay')!);
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('ErrorBanner shows the message and request reference, and a retry', () => {
    const retry = vi.fn();
    render(<ErrorBanner error={new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong', [], {}, 'req-42')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Reference: req-42');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    expect(render(<ErrorBanner error={null} />).container).toBeEmptyDOMElement();
  });
  it('Confirm runs the action, stays open and shows the error on failure, closes on success', async () => {
    const onClose = vi.fn();
    const fail = vi.fn().mockRejectedValue(new ApiError(409, 'X', 'Not allowed now'));
    const { unmount } = render(
      <ToastProvider>
        <Confirm title="Revoke?" body="sure" confirmLabel="Yes" onConfirm={fail} onClose={onClose} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByText('Not allowed now')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
    const ok = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <Confirm title="Revoke?" body="sure" confirmLabel="Yes" onConfirm={ok} onClose={onClose} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
  it('ResponseBar exposes the proportions to screen readers', () => {
    render(<ResponseBar yes={3} maybe={1} no={2} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '3 yes, 1 maybe, 2 no');
  });
});

describe('client role mirror (UI hiding only; the API enforces the rules)', () => {
  it('matches the server matrix for the capabilities the UI branches on', () => {
    expect(roleCan.guests('planner')).toBe(true);
    expect(roleCan.guests('caterer')).toBe(false);
    expect(roleCan.guests('checkin_staff')).toBe(false);
    expect(roleCan.dashboard('readonly')).toBe(true);
    expect(roleCan.dashboard('caterer')).toBe(false);
    expect(roleCan.catering('caterer')).toBe(true);
    expect(roleCan.catering('checkin_staff')).toBe(false);
    expect(roleCan.checkin('checkin_staff')).toBe(true);
    expect(roleCan.checkin('readonly')).toBe(false);
    expect(roleCan.manage('organizer')).toBe(true);
    expect(roleCan.owner('organizer')).toBe(false);
    expect(roleCan.createEvent('planner')).toBe(false);
  });
});
