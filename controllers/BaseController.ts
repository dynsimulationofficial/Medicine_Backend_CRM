import { Response } from 'express';

export default class BaseController{

    protected sendSuccess(res: Response, data: object,message:string,code=200): void {
        const response = {
            success:true,
            
            msg:message,
            data:data
        }
        res.status(code).send(response)
    }

    protected sendError(res: Response, data: unknown,message:string,code=400): void {
        const response = {
            success:false,
            msg:message,
            data:data
        }
        res.status(code).send(response)
    }


}