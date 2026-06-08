-- Updates §1 — email is a source; add OUTLOOK to the ticket source enum.
ALTER TYPE "TicketSource" ADD VALUE IF NOT EXISTS 'OUTLOOK';
