import os

import scriptutils

if __name__ == "__main__":
    # 切换工作空间
    scriptutils.switch_workdir()

    # 获取当前工作空间
    cwd = scriptutils.get_workdir()

    dist_folder = "./dist"
    data = scriptutils.read_json_file(cwd + "package.json")
    v = data["version"]

    src_folder = dist_folder
    build_zip_path = "./build"
    build_zip_name = "mymind-" + v + ".zip"

    try:
        # 创建build目录
        scriptutils.mkdir(build_zip_path)
        
        # 直接压缩dist文件夹的内容，不添加额外的文件夹层级
        scriptutils.create_zip(src_folder, build_zip_name, [], build_zip_path)
        
        # 复制一份为package.zip
        scriptutils.cp_file(os.path.join(build_zip_path, build_zip_name), os.path.join(build_zip_path, "package.zip"))
    except Exception as e:
        print(f"打包错误,{str(e)}")
    print("插件打包完毕.")
