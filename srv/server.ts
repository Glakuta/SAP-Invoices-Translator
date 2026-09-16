import dotenv from "dotenv";
import cds from "@sap/cds";


cds.once("bootstrap", async () => {
  const { InvoiceService } = cds.services;})
dotenv.config();
