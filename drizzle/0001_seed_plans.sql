-- Initial pricing hypotheses from the product brief (CHF / month). Prices and limits are data and can be changed without a deploy.
INSERT INTO "plans" ("id", "name", "price_chf_monthly", "limits") VALUES
  ('solo', 'Solo', 19.00, '{"users":1,"sources":3,"bexio_sync":false,"multi_client":false}'),
  ('pro', 'Pro', 49.00, '{"users":3,"sources":null,"bexio_sync":true,"multi_client":false}'),
  ('fiduciaire', 'Fiduciaire', 149.00, '{"users":null,"sources":null,"bexio_sync":true,"multi_client":true}'),
  ('enterprise', 'Enterprise', NULL, '{"users":null,"sources":null,"bexio_sync":true,"multi_client":true}')
ON CONFLICT ("id") DO NOTHING;
