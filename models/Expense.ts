import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface ExpenseAttrs {
  id: string;
  user_id: string;
  reason: string;
  amount: number;
  expense_date: Date | string;
  transaction_date?: Date | string | null;
  pay_from: string;
  description?: string | null;
}

type ExpenseCreation = Optional<
  ExpenseAttrs,
  "id" | "transaction_date" | "description"
>;

export const initExpenseModel = (sequelize: Sequelize) => {
  class Expense
    extends Model<ExpenseAttrs, ExpenseCreation>
    implements ExpenseAttrs {
    public id!: string;
    public user_id!: string;
    public reason!: string;
    public amount!: number;
    public expense_date!: Date | string;
    public transaction_date!: Date | string | null;
    public pay_from!: string;
    public description!: string | null;
  }

  Expense.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      user_id: { type: DataTypes.UUID, allowNull: false },
      reason: { type: DataTypes.STRING(255), allowNull: false },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      expense_date: { type: DataTypes.DATEONLY, allowNull: false },
      transaction_date: { type: DataTypes.DATEONLY, allowNull: true },
      pay_from: { type: DataTypes.UUID, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      tableName: "expenses",
      schema: "public",
      timestamps: false,
    }
  );

  return Expense;
};
