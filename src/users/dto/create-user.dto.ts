import { IsEmail, IsOptional, IsString } from "class-validator"

export class CreateUserDto {
    @IsString()
    name:string

    @IsString()
    lastname:string

    @IsString()
    @IsEmail()
    email:string

    @IsString()
    phone:string

    @IsString()
    password:string

    @IsString()
    @IsOptional()
    image?:string

    @IsOptional()
    @IsString()
    notification_token?:string
}
