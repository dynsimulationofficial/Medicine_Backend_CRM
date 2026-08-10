import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

export default class MetroFareProvider {
  private baseURL: string;
  private instance: AxiosInstance;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.instance = axios.create({ baseURL });

    // Add response interceptor
    this.instance.interceptors.response.use(
      this.handleResponse,
      this.handleError
    );
  }

  public async post(url: string, data?: any, config?: AxiosRequestConfig<any> | undefined): Promise<AxiosResponse> {
    return this.instance.post(url, data, config);
  }

  private handleResponse(response: AxiosResponse): AxiosResponse {
    return response;
  }

  private handleError(error: any): Promise<never> {
    console.error('Error:', error);
    return Promise.reject(error);
  }

}