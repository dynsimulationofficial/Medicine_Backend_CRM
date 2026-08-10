// controllers/Validations.ts
import * as Yup from "yup";
import * as yup from "yup";

/* ---------------- Shared helpers ---------------- */
const E164_PHONE = /^\+\d{1,3}\d{10}$/; // +<cc><10digits>
const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const uuid = () => yup.string().matches(UUID_RX, "Must be a valid UUID");

/* ---------------- Users ---------------- */
export const createUserSchema = Yup.object().shape({
  name: Yup.string().required("Name is required"),
  mobile_number: Yup.string()
    .matches(
      E164_PHONE,
      "Mobile number must include country code and be in the format +<country_code><number>"
    )
    .required("Mobile number is required"),
  email: Yup.string().email("Invalid email format").required("Email is required"),
  password: Yup.string()
    .min(6, "Password must be at least 6 characters")
    .required("Password is required"),
  roleLevel: Yup.number()
    .typeError("Role level must be a number")
    .required("Role level is required"),
}).noUnknown(true);

// Define Yup schema for login user
export const loginSchema = Yup.object().shape({
  email: Yup.string().email("Invalid email format").required("Email is required"),
  password: Yup.string().required("Password is required"),
}).noUnknown(true);

// Define Yup schema for userId
export const getUserDetailsSchema = Yup.object({
  id: Yup.string().required("User ID is required"),
}).noUnknown(true);

// Define Yup schema for updating user details
export const updateUserSchema = Yup.object({
  name: Yup.string().optional(),
  mobile_number: Yup.string()
    .matches(
      E164_PHONE,
      "Mobile number must include country code and be in the format +<country_code><number>"
    )
    .optional(),
  email: Yup.string().email("Invalid email format").optional(),
}).noUnknown(true);

// Define Yup schema for getalluser details
export const getAllUsersSchema = Yup.object().shape({
  page: Yup.number().min(1).default(1), // Optional pagination, defaulting to page 1
  pageSize: Yup.number().min(1).max(100).default(10), // Optional page size, defaulting to 10
}).noUnknown(true);

// Define Yup schema for delete user
export const deleteUserSchema = Yup.object().shape({
  id: Yup.string().required("User ID is required"),
}).noUnknown(true);

// Define Yup schema for verifytotp
export const verifytotpSchema = Yup.object().shape({
  token: Yup.string().required("token is required"),
  secretKey: Yup.string().required("SecretKey is required"),
  userId: Yup.string().required("userId is required"),
}).noUnknown(true);

// Define Yup schema for fetchsecretkey
export const fetchsecretkeySchema = Yup.object().shape({
  userId: Yup.string().required("userId is required"),
}).noUnknown(true);

// Define Yup schema for deletesecretkey
export const deletesecretkeySchema = Yup.object().shape({
  userId: Yup.string().required("userId is required"),
}).noUnknown(true);

// Define Yup schema for resetpassword
export const resetPasswordSchema = Yup.object()
  .shape({
    email: Yup.string().email("Invalid email format").optional(),
    mobile_number: Yup.string()
      .matches(
        E164_PHONE,
        "Mobile number must include country code and be in the format +<country_code><number>"
      )
      .optional(),
    new_password: Yup.string()
      .min(6, "Password must be at least 6 characters")
      .max(20, "Password must be at most 20 characters")
      .notOneOf(
        ["123456", "password", "12345678", "qwerty", "abc123"],
        "Weak password is not allowed"
      )
      .required("New password is required"),
  })
  .test(
    "email-or-mobile",
    "Either email or mobile_number is required",
    (v) => !!(v?.email || v?.mobile_number)
  )
  .noUnknown(true);

export const logUserActivitySchema = Yup.object().shape({
  userId: Yup.string().required("User ID is required"),
  userActivity: Yup.string().required("userActivity is required"),
  module: Yup.string().required("Module is required"), // Ensure module is required
  type: Yup.string().required("Type is required"), // Ensure type is required
}).noUnknown(true);

export const filteruseractivitySchema = Yup.object({
  uuId: Yup.string(),
  userActivity: Yup.string(),
  startDate: Yup.date().typeError(
    "startDate must be a valid date (YYYY-MM-DD format)"
  ),
  endDate: Yup.date().typeError(
    "endDate must be a valid date (YYYY-MM-DD format)"
  ),
  module: Yup.string(),
  type: Yup.string(),
})
  .test(
    "at-least-one-field",
    "At least one filter field is required",
    (value) =>
      !!Object.values(value || {}).filter((v) => v !== undefined && v !== "")
        .length
  )
  .test("date-order", "endDate must be on/after startDate", (v) => {
    if (v?.startDate && v?.endDate) return v.endDate >= v.startDate;
    return true;
  })
  .noUnknown(true);

/* ---------------- Vendors ---------------- */
export const createVendorSchema = yup
  .object({
    company: yup.string().trim().max(255).required(),
    vendor: yup.string().trim().max(255).required(),
    mobile: yup.string().trim().max(20).nullable(),
    email_id: yup.string().trim().email().max(255).nullable(),
    city: yup.string().trim().max(100).nullable(),
    state: yup.string().trim().max(100).nullable(),
    pin_code: yup.string().trim().max(10).nullable(),
    gstin: yup.string().trim().max(20).nullable(),
    category: yup.string().trim().max(100).nullable(),
    address: yup.string().trim().nullable(),
  })
  .noUnknown(true);

export const updateVendorSchema = createVendorSchema.partial().noUnknown(true);

/* ---------------- Expenses (for your Expense CRUD) ---------------- */
export const createExpenseSchema = yup
  .object({
    user_id: uuid().required("user_id is required"),
    reason: yup.string().trim().max(255).required("reason is required"),
    amount: yup
      .number()
      .typeError("amount must be a number")
      .moreThan(0, "amount must be > 0")
      .max(999999999999.99)
      .required("amount is required"),
    expense_date: yup
      .string()
      .matches(ISO_DATE_RX, "expense_date must be YYYY-MM-DD")
      .required("expense_date is required"),
    transaction_date: yup
      .string()
      .matches(ISO_DATE_RX, "transaction_date must be YYYY-MM-DD")
      .nullable()
      .optional(),
    pay_from: uuid().required("pay_from is required"), // references accounts.id
    description: yup.string().trim().nullable(),
  })
  .noUnknown(true);

export const updateExpenseSchema = yup
  .object({
    reason: yup.string().trim().max(255),
    amount: yup
      .number()
      .typeError("amount must be a number")
      .moreThan(0, "amount must be > 0")
      .max(999999999999.99),
    expense_date: yup
      .string()
      .matches(ISO_DATE_RX, "expense_date must be YYYY-MM-DD"),
    transaction_date: yup
      .string()
      .matches(ISO_DATE_RX, "transaction_date must be YYYY-MM-DD"),
    pay_from: uuid(),
    description: yup.string().trim().nullable(),
  })
  .noUnknown(true);

export const listExpenseQuerySchema = yup
  .object({
    page: yup.number().min(1).default(1),
    pageSize: yup.number().min(1).max(100).default(10),
    startDate: yup
      .string()
      .matches(ISO_DATE_RX, { message: "startDate must be YYYY-MM-DD", excludeEmptyString: true })
      .optional(),
    endDate: yup
      .string()
      .matches(ISO_DATE_RX, { message: "endDate must be YYYY-MM-DD", excludeEmptyString: true })
      .optional(),
    accountId: uuid().optional(),
    search: yup.string().trim().optional(), // reason/description search
  })
  .noUnknown(true);

export const createMarketSchema = yup.object({
  company_name: yup.string().max(255).required(),
  customer_name: yup.string().max(255).required(),
  mobile: yup.string().max(20).nullable(),
  email_id: yup.string().email().max(255).nullable(),
  location: yup.string().max(255).nullable(),
  status: yup.string().max(100).nullable(),
  assign_to_senior: yup.string().max(100),
  review: yup.string().nullable(),
});

export const updateMarketSchema = createMarketSchema.noUnknown(true).shape({
  company_name: yup.string().max(255).optional(),
  customer_name: yup.string().max(255).optional(),
});

export const createTicketSchema = Yup.object({
  caller_id: Yup.string().max(100).required("caller_id is required"),
  market_id: Yup.string().uuid().nullable(),          // link to market.id
  subject: Yup.string().max(255).required("subject is required"),
  status: Yup.string().max(50).required("status is required"),
  priority: Yup.string().max(20).nullable(),
  description: Yup.string().nullable(),
  created_by: Yup.string().uuid().nullable(),
  attachments: Yup.array().of(Yup.mixed()).default([]),
});

export const updateTicketSchema = Yup.object({
  caller_id: Yup.string().max(100),
  market_id: Yup.string().uuid().nullable(),          // can re-link to another market
  subject: Yup.string().max(255),
  status: Yup.string().max(50),
  priority: Yup.string().max(20).nullable(),
  description: Yup.string().nullable(),
  created_by: Yup.string().uuid().nullable(),
  attachments: Yup.array().of(Yup.mixed()),
  closed_at: Yup.date().nullable(),

  // Optional pass-through to update related Market row (if market_id is set on ticket)
  market: Yup.object({
    company_name: Yup.string().max(255),
    category: Yup.string().max(100),
    assign_to_senior: Yup.string().max(255),
  }).noUnknown().optional(),
});

export const CreatePOSchema = yup
  .object({
    vendor_id: yup
      .string()
      .matches(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        "Must be a valid UUID"
      )
      .required("vendor_id is required"),
    delivery_address: yup.string().trim().nullable(),
    delivery_phone: yup.string().trim().nullable(),
    notes: yup.string().trim().nullable(),
    status: yup
      .string()
      .oneOf(["draft", "approved", "cancelled"])
      .default("draft"),
    items: yup
      .array()
      .of(
        yup.object({
          item_desc: yup.string().trim().required("item_desc is required"),
          unit: yup.string().trim().required("unit is required"),
          hsn_sac: yup.string().trim().max(10).nullable(),
          quantity: yup
            .number()
            .typeError("quantity must be a number")
            .moreThan(0, "quantity must be greater than 0")
            .required("quantity is required"),
          rate: yup
            .number()
            .typeError("rate must be a number")
            .min(0, "rate must be >= 0")
            .required("rate is required"),
        })
      )
      .min(1, "At least one item is required")
      .required("items is required"),
  })
  .noUnknown(true);

export const UpdatePOSchema = CreatePOSchema.noUnknown(true).shape({
  vendor_id: yup.string().uuid().optional(),
  items: yup
    .array()
    .of(
      yup.object({
        item_desc: yup.string().trim().required("item_desc is required"),
        unit: yup.string().trim().required("unit is required"),
        hsn_sac: yup.string().trim().max(10).nullable(),
        quantity: yup
          .number()
          .typeError("quantity must be a number")
          .moreThan(0, "quantity must be greater than 0")
          .required("quantity is required"),
        rate: yup
          .number()
          .typeError("rate must be a number")
          .min(0, "rate must be >= 0")
          .required("rate is required"),
      })
    )
    .min(1, "At least one item is required")
    .required("items is required"),
});

// --- New schema for login request OTP ---
export const loginRequestOtpSchema = Yup.object({
  email: Yup.string().email("Invalid email").required("Email is required"),
  password: Yup.string().min(6, "Password must be at least 6 characters").required("Password is required"),
});



