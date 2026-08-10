import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface Attachment {
    path: string;
    name: string;
    type: string;
}

export interface EmailTemplateAttributes {
    id: string;
    title: string;
    subject: string;
    body: string;
    attachments?: Attachment[] | null; // <-- change from string to Attachment[]
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export type EmailTemplateCreationAttributes = Optional<
    EmailTemplateAttributes,
    "id" | "created_at" | "updated_at" | "deleted_at" | "attachments"
>;

export class EmailTemplate extends Model<EmailTemplateAttributes, EmailTemplateCreationAttributes>
    implements EmailTemplateAttributes {
    public id!: string;
    public title!: string;
    public subject!: string;
    public body!: string;
    public attachments!: Attachment[] | null; // <-- match interface
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;
}

// Initialize model
export const initEmailTemplateModel = (sequelize: Sequelize) => {
    EmailTemplate.init(
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
            title: { type: DataTypes.STRING, allowNull: false },
            subject: { type: DataTypes.STRING, allowNull: false },
            body: { type: DataTypes.TEXT, allowNull: false },
            attachments: { type: DataTypes.JSONB, allowNull: true }, // <-- store array of attachments
            created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            deleted_at: { type: DataTypes.DATE, allowNull: true },
        },
        {
            sequelize,
            tableName: "email_templates",
            schema: "public",
            timestamps: false,
        }
    );

    return EmailTemplate;
};
