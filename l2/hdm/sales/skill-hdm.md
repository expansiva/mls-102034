# skill-hdm.md — Sales and Order Management (HDM-05)

## Module summary
Manages the outbound commercial cycle from quote to delivery and billing.
Integrates with inventory for stock reservation and financial for receivables.

## Clarification questions
- Quote-to-order flow or direct order entry?
- Price tables and commercial discount policies needed?
- Partial delivery allowed or complete order only?
- Return and reverse logistics process needed?
- B2B (company buyers), B2C (individuals), or both?
- Credit limit control per customer?

## Features
- core: customer register, sales order, delivery, sales invoice
- optional: sales quote with validity
- optional: price lists and discounts
- optional: credit limit control
- optional: return orders and reverse logistics

## KPIs
- Open orders by status and customer
- On-time delivery rate
- Average order to delivery time
- Revenue by customer, product, and period
- Overdue receivables aging
- Quote conversion rate

## Mock orientation
Generate: 15 customers, 20 sales orders in various statuses, 10 deliveries,
12 sales invoices (mix paid/overdue). Include 2 customers over credit limit.
