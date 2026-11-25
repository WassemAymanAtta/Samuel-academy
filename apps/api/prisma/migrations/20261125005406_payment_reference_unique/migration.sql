-- Prevent the same student from submitting the same transfer reference twice.
CREATE UNIQUE INDEX "PaymentRequest_userId_reference_key" ON "PaymentRequest"("userId", "reference");
